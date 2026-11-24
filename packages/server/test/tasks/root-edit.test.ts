import { expect, test } from "bun:test";
import type { claimTask, OutputOf, readEvents } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, OWNER } from "../support/app.ts";

test("a root edit holds an adopted task and fences its claim until the owner lifts the hold", async () => {
  const app = makeApp();
  const fixer = (path: string, body: object) =>
    app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${OWNER.token}`,
          "x-board-profile": "fixer",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );

  try {
    expect((await fixer("/messages", { channel: "dev", text: "work" })).status).toBe(201);
    expect((await call(app, "POST", "/tasks", { re: "2" })).status).toBe(201);
    const claimed = await call(app, "POST", "/tasks/2/claim");
    expect(claimed.status).toBe(200);
    const {
      claim: { epoch, token },
    } = (await claimed.json()) as OutputOf<typeof claimTask>;
    expect((await call(app, "POST", "/messages/2/edit", { text: "owner edit" })).status).toBe(200);
    const read = () => call(app, "GET", "/messages/2");
    expect(await (await read()).json()).toMatchObject({
      message: { text: "owner edit", task: { state: "claimed", claim: { actor: LOCAL_OWNER }, epoch, blocked: null } },
    });

    const head = await call(app, "GET", "/events?after=0");
    const { cursor } = (await head.json()) as OutputOf<typeof readEvents>;
    expect((await fixer("/messages/2/edit", { text: "new text" })).status).toBe(200);
    const projection = {
      id: "2",
      text: "new text",
      task: { state: "blocked", blocked: { kind: "edited" }, claim: null, epoch },
      labels: { "board.task": "blocked" },
    };
    expect(await (await read()).json()).toMatchObject({ message: projection });
    const feed = await call(app, "GET", `/events?after=${cursor}`);
    const { events } = (await feed.json()) as OutputOf<typeof readEvents>;
    expect(events.map(({ type }) => type)).toEqual(["message.edited", "task.blocked"]);
    expect(events[1]).toMatchObject({
      cursor: String(Number(events[0]?.cursor) + 1),
      payload: { id: "2", kind: "edited" },
      message: projection,
    });

    const completed = await call(app, "POST", "/tasks/2/complete", { epoch, token });
    expect(completed.status).toBe(409);
    expect(await completed.json()).toMatchObject({ error: { code: "claim_lost" } });
    const lifted = await call(app, "POST", "/tasks/2/unblock");
    expect(lifted.status).toBe(200);
    expect(await lifted.json()).toMatchObject({ outcome: "unblocked", task: { task: { state: "ready" } } });
  } finally {
    await app.close();
  }
});
