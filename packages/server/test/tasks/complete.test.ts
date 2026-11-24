import { expect, test } from "bun:test";
import type { claimTask, OutputOf, readEvents } from "@openboard/contract";
import { call, LOCAL_OWNER, makeApp } from "../support/app.ts";

test("completion settles one claim and projects the result to reads, lists and events", async () => {
  const app = makeApp();
  try {
    await call(app, "POST", "/tasks", { channel: "dev", text: "fix the build" });
    const claimed = await call(app, "POST", "/tasks/2/claim");
    const { task, claim } = (await claimed.json()) as OutputOf<typeof claimTask>;
    const path = `/tasks/${task.id}`;
    const body = { epoch: claim.epoch, token: claim.token, result: "fixed in a1b2c3" };
    const responses = await Promise.all([
      call(app, "POST", `${path}/complete`, body),
      call(app, "POST", `${path}/complete`, body),
    ]);
    const winner = responses.find(({ status }) => status === 200);
    if (!winner) throw new Error(`no completion landed: ${responses.map(({ status }) => status)}`);
    const loser = responses.find((response) => response !== winner);
    expect(loser?.status).toBe(409);
    expect(await loser?.json()).toMatchObject({ error: { code: "claim_lost" } });
    const completed = {
      id: task.id,
      labels: { "board.task": "completed" },
      task: { state: "completed", claim: null, result: body.result },
    };
    expect(await winner.json()).toMatchObject({ task: completed });
    expect(await (await call(app, "GET", `/messages/${task.id}`)).json()).toMatchObject({ message: completed });
    expect(await (await call(app, "GET", "/tasks?channel=dev")).json()).toMatchObject({ tasks: [] });
    expect(await (await call(app, "GET", "/tasks?channel=dev&state=completed")).json()).toMatchObject({
      tasks: [{ message: completed }],
    });
    const reclaim = await call(app, "POST", `${path}/claim`);
    expect(reclaim.status).toBe(409);
    expect(await reclaim.json()).toMatchObject({ error: { code: "task_finished" } });
    for (const query of ["after=0", "last=10"]) {
      const feed = await call(app, "GET", `/events?${query}`);
      const { events } = (await feed.json()) as OutputOf<typeof readEvents>;
      const completions = events.filter((event) => event.type === "task.completed");
      expect(completions).toHaveLength(1);
      expect(completions[0]?.payload).toEqual({
        id: task.id,
        thread: task.id,
        epoch: claim.epoch,
        result: body.result,
        by: { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null },
      });
      expect(completions[0]?.message).toMatchObject(completed);
      expect(JSON.stringify(events)).not.toContain(claim.token);
    }
  } finally {
    await app.close();
  }
});

test("a task result must contain storable text of at most 1,000 characters", async () => {
  const app = makeApp();
  try {
    await call(app, "POST", "/tasks", { channel: "dev", text: "fix the build" });
    const claimed = await call(app, "POST", "/tasks/2/claim");
    const { claim } = (await claimed.json()) as OutputOf<typeof claimTask>;
    const proof = { epoch: claim.epoch, token: claim.token };
    for (const result of ["", "  ", "a\0b", "\ud800", "a".repeat(1001)]) {
      const response = await call(app, "POST", "/tasks/2/complete", { ...proof, result });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    const result = "👍".repeat(500);
    const response = await call(app, "POST", "/tasks/2/complete", { ...proof, result });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ task: { task: { state: "completed", result } } });
  } finally {
    await app.close();
  }
});
