import { expect, test } from "bun:test";
import type { createTask, OutputOf, readEvents } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

test("replacing task prerequisites updates the dependency index and folds readiness in the same write", async () => {
  const app = makeApp();
  try {
    async function create(text: string, claim = false) {
      const response = await call(app, "POST", "/tasks", { channel: "dev", text, claim });
      expect(response.status).toBe(201);
      return (await response.json()) as OutputOf<typeof createTask>;
    }
    const { task: first, claim: firstClaim } = await create("first prerequisite", true);
    const { task: second, claim: secondClaim } = await create("replacement prerequisite", true);
    const { task: root } = await create("dependant");
    const change = (needs: string[]) => call(app, "POST", `/tasks/${root.id}/needs`, { needs });
    const feed = async (after: number) => {
      const response = await call(app, "GET", `/events?after=${after}&re=${root.id}`);
      expect(response.status).toBe(200);
      return (await response.json()) as OutputOf<typeof readEvents>;
    };
    for (const need of [first.id, second.id]) {
      const response = await change([need]);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        task: { labels: { "board.task": "waiting" }, task: { state: "waiting", needs: [need] } },
      });
    }
    for (const [task, claim] of [
      [first, firstClaim],
      [second, secondClaim],
    ] as const) {
      const response = await call(app, "POST", `/tasks/${task.id}/complete`, {
        epoch: claim?.epoch,
        token: claim?.token,
      });
      expect(response.status).toBe(200);
      const read = await call(app, "GET", `/messages/${root.id}`);
      expect(await read.json()).toMatchObject({
        message: { task: { state: task === first ? "waiting" : "ready", needs: [second.id] } },
      });
    }

    const changed = await change([first.id, second.id]);
    expect(await changed.json()).toMatchObject({ task: { task: { state: "ready", needs: [first.id, second.id] } } });
    const before = await feed(root.version);
    const sameSet = await change([second.id, first.id, first.id]);
    expect(await sameSet.json()).toMatchObject({
      task: { version: Number(before.cursor), task: { state: "ready", needs: [first.id, second.id] } },
    });
    expect(await feed(Number(before.cursor))).toEqual({ events: [], cursor: before.cursor });
    expect(await (await change([])).json()).toMatchObject({ task: { task: { state: "ready", needs: [] } } });
    const { events } = await feed(root.version);
    expect(events.map((event) => [event.type, "message" in event && event.message.task?.state])).toEqual([
      ["task.needs_changed", "waiting"],
      ["task.needs_changed", "waiting"],
      ["task.ready", "ready"],
      ["task.needs_changed", "waiting"],
      ["task.ready", "ready"],
      ["task.needs_changed", "ready"],
    ]);
  } finally {
    await app.close();
  }
});
