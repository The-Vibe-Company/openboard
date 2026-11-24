import { expect, test } from "bun:test";
import type { claimTask, OutputOf, readEvents } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

test.each(["ready", "claimed", "failed", "completed", "canceled"])("deleting a %s task root", async (state) => {
  const app = makeApp();
  try {
    expect((await call(app, "POST", "/tasks", { channel: "dev", text: "fix the build" })).status).toBe(201);
    const path = "/tasks/2";
    if (state === "claimed" || state === "failed" || state === "completed") {
      const claimed = await call(app, "POST", `${path}/claim`);
      expect(claimed.status).toBe(200);
      const { claim } = (await claimed.json()) as OutputOf<typeof claimTask>;
      if (state !== "claimed") {
        const body = state === "completed" ? { result: "fixed" } : { reason: "broken" };
        const action = state === "completed" ? "complete" : "fail";
        expect(
          (await call(app, "POST", `${path}/${action}`, { ...body, epoch: claim.epoch, token: claim.token })).status,
        ).toBe(200);
      }
    } else if (state === "canceled") {
      expect((await call(app, "POST", `${path}/cancel`, { reason: "already called off" })).status).toBe(200);
    }
    const before = await call(app, "GET", "/events?after=0");
    const { cursor } = (await before.json()) as OutputOf<typeof readEvents>;
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await call(app, "POST", "/messages/2/delete", {})).status).toBe(200);
    }
    const feed = await call(app, "GET", `/events?after=${cursor}`);
    const { events } = (await feed.json()) as OutputOf<typeof readEvents>;
    const terminal = state === "completed" || state === "canceled";
    expect(events.map(({ type }) => type)).toEqual(
      terminal ? ["message.deleted"] : ["message.deleted", "task.canceled"],
    );
    if (!terminal) {
      expect(events[1]).toMatchObject({
        cursor: String(Number(events[0]?.cursor) + 1),
        payload: { id: "2", reason: "deleted" },
      });
    }

    const finalState = state === "completed" ? "completed" : "canceled";
    const details =
      state === "completed" ? { result: "fixed" } : { reason: state === "canceled" ? "already called off" : "deleted" };
    const list = await call(app, "GET", `/tasks?channel=dev&state=${finalState}`);
    expect(await list.json()).toMatchObject({
      tasks: [
        {
          message: {
            id: "2",
            deleted: true,
            text: "",
            labels: { "board.task": finalState },
            task: { state: finalState, claim: null, ...details },
          },
        },
      ],
    });
    expect((await call(app, "POST", `${path}/claim`)).ok).toBe(false);
  } finally {
    await app.close();
  }
});
