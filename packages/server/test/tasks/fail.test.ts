import { expect, test } from "bun:test";
import type { claimTask, OutputOf, readEvents } from "@openboard/contract";
import { call, LOCAL_OWNER, makeApp } from "../support/app.ts";

test("failure settles one claim and projects the reason to reads, lists and events", async () => {
  const app = makeApp();
  try {
    await call(app, "POST", "/tasks", { channel: "dev", text: "fix the build" });
    const claimed = await call(app, "POST", "/tasks/2/claim");
    const { task, claim } = (await claimed.json()) as OutputOf<typeof claimTask>;
    const path = `/tasks/${task.id}`;
    const body = { epoch: claim.epoch, token: claim.token, reason: "no access to the repo" };
    for (const reason of ["", "a".repeat(1001), "a\0b", "\ud800"]) {
      const invalid = await call(app, "POST", `${path}/fail`, { ...body, reason });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    const responses = await Promise.all([
      call(app, "POST", `${path}/fail`, body),
      call(app, "POST", `${path}/fail`, body),
    ]);
    const winner = responses.find(({ status }) => status === 200);
    if (!winner) throw new Error(`no failure landed: ${responses.map(({ status }) => status)}`);
    const loser = responses.find((response) => response !== winner);
    expect(loser?.status).toBe(409);
    expect(await loser?.json()).toMatchObject({ error: { code: "claim_lost" } });
    const failed = {
      id: task.id,
      labels: { "board.task": "failed" },
      task: { state: "failed", claim: null, reason: body.reason },
    };
    expect(await winner.json()).toMatchObject({ task: failed });
    expect(await (await call(app, "GET", `/messages/${task.id}`)).json()).toMatchObject({ message: failed });
    expect(await (await call(app, "GET", "/tasks?channel=dev")).json()).toMatchObject({ tasks: [] });
    expect(await (await call(app, "GET", "/tasks?channel=dev&state=failed")).json()).toMatchObject({
      tasks: [{ message: failed }],
    });
    const reclaim = await call(app, "POST", `${path}/claim`);
    expect(reclaim.status).toBe(409);
    expect(await reclaim.json()).toMatchObject({ error: { code: "task_finished" } });
    for (const query of ["after=0", "last=10"]) {
      const feed = await call(app, "GET", `/events?${query}`);
      const { events } = (await feed.json()) as OutputOf<typeof readEvents>;
      const failures = events.filter((event) => event.type === "task.failed");
      expect(failures).toHaveLength(1);
      expect(failures[0]?.payload).toEqual({
        id: task.id,
        thread: task.id,
        epoch: claim.epoch,
        reason: body.reason,
        by: { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null },
      });
      expect(failures[0]?.message).toMatchObject(failed);
      expect(JSON.stringify(events)).not.toContain(claim.token);
    }
  } finally {
    await app.close();
  }
});
