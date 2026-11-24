import { expect, test } from "bun:test";
import type { claimTask, createTask, OutputOf, readEvents } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;

async function create(app: App, input: (typeof createTask.input.body)["static"]) {
  const response = await call(app, "POST", "/tasks", input);
  expect(response.status).toBe(201);
  return (await response.json()) as OutputOf<typeof createTask>;
}

async function readReadyFeed(app: App, after?: string) {
  const query = new URLSearchParams({ channel: "dev", label: "board.task=ready" });
  if (after !== undefined) query.set("after", after);
  const response = await call(app, "GET", `/events?${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as OutputOf<typeof readEvents>;
}

test("the ready-task feed includes transitions into and out of ready without claim tokens", async () => {
  const app = makeApp();
  try {
    const prerequisite = await create(app, { channel: "dev", text: "Build", claim: true });
    if (!prerequisite.claim) throw new Error("expected a prerequisite claim");
    const { token, epoch } = prerequisite.claim;
    const { task } = await create(app, { channel: "dev", text: "Test", needs: [prerequisite.task.id] });
    const { cursor } = await readReadyFeed(app);

    await create(app, { channel: "release", text: "Deploy", needs: [prerequisite.task.id] });
    const completion = await call(app, "POST", `/tasks/${prerequisite.task.id}/complete`, { token, epoch });
    expect(completion.status).toBe(200);
    const ready = await readReadyFeed(app, cursor);
    expect(ready.events).toMatchObject([{ type: "task.ready", message: { id: task.id, task: { state: "ready" } } }]);

    const response = await call(app, "POST", `/tasks/${task.id}/claim`);
    expect(response.status).toBe(200);
    const { claim, task: claimedTask } = (await response.json()) as OutputOf<typeof claimTask>;
    const claimed = await readReadyFeed(app, ready.cursor);
    expect(claimed.events).toMatchObject([
      {
        cursor: String(claimedTask.version),
        type: "task.claimed",
        message: { id: task.id, labels: { "board.task": "claimed" }, task: { state: "claimed" } },
      },
    ]);

    const replay = await readReadyFeed(app, cursor);
    expect(replay.events).toEqual([...ready.events, ...claimed.events]);
    const serialized = JSON.stringify(replay.events);
    expect([token, claim.token].some((secret) => serialized.includes(secret))).toBe(false);
    expect(serialized.includes('"token":')).toBe(false);
  } finally {
    await app.close();
  }
});
