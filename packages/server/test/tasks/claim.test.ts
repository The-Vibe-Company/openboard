import { afterEach, expect, test } from "bun:test";
import type { claimTask, createConnection, createTask, OutputOf, readEvents } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp } from "../support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

test("of three concurrent claims, one lands and only its answer carries a token", async () => {
  app = makeApp();
  const creation = await call(app, "POST", "/tasks", { channel: "dev", text: "fix the build" });
  const { task } = (await creation.json()) as OutputOf<typeof createTask>;
  const responses = await Promise.all(Array.from({ length: 3 }, () => call(app, "POST", `/tasks/${task.id}/claim`)));
  const winner = responses.find((response) => response.status === 200);
  if (!winner) throw new Error("no claim won");
  const claimed = (await winner.json()) as OutputOf<typeof claimTask>;
  expect(claimed.claim.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const until = "2023-11-14T22:28:20.000Z";
  expect(claimed.claim).toMatchObject({ epoch: 1, until });
  const losers = responses.filter((response) => response !== winner);
  expect(losers.map(({ status }) => status)).toEqual([409, 409]);
  for (const loser of losers) expect(await loser.json()).toMatchObject({ error: { code: "task_claimed" } });
  const thread = await call(app, "GET", `/messages/${task.id}`);
  expect(await thread.json()).toMatchObject({
    message: {
      labels: { "board.task": "claimed" },
      task: { state: "claimed", epoch: 1, claim: { actor: LOCAL_OWNER, until } },
    },
  });
  const list = await call(app, "GET", "/tasks?state=claimed");
  expect(await list.json()).toMatchObject({ tasks: [{ message: claimed.task }] });
  const feed = await call(app, "GET", "/events?after=0");
  const { events } = (await feed.json()) as OutputOf<typeof readEvents>;
  expect(events.at(-1)).toEqual({
    cursor: String(claimed.task.version),
    type: "task.claimed",
    createdAt: "2023-11-14T22:13:20.000Z",
    payload: {
      id: task.id,
      thread: task.id,
      epoch: 1,
      until,
      by: { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null },
    },
    message: claimed.task,
  });
});

test("a plain thread is not a task and invalid leases are refused", async () => {
  app = makeApp();
  await call(app, "POST", "/messages", { channel: "dev", text: "plain thread" });
  const plain = await call(app, "POST", "/tasks/2/claim");
  expect(plain.status).toBe(404);
  expect(await plain.json()).toMatchObject({ error: { code: "not_a_task" } });
  for (const lease of [29, 3601]) {
    const invalid = await call(app, "POST", "/tasks/2/claim", { lease });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_request" } });
  }
});

test("starting or adopting a task can claim it in the same write", async () => {
  app = makeApp();
  await call(app, "POST", "/messages", { channel: "dev", text: "adopt me" });
  for (const input of [{ channel: "dev", text: "new" }, { re: "2" }]) {
    const creation = await call(app, "POST", "/tasks", { ...input, claim: true });
    expect(creation.status).toBe(201);
    const { task, claim } = (await creation.json()) as OutputOf<typeof createTask>;
    expect(task.task.state).toBe("claimed");
    expect(claim).toMatchObject({ epoch: 1, token: expect.any(String) });
    expect((await call(app, "POST", `/tasks/${task.id}/claim`)).status).toBe(409);
  }
});

test("the claim endpoint and create with claim require label in the task channel", async () => {
  app = makeApp();
  await call(app, "POST", "/tasks", { channel: "dev", text: "ready" });
  const issue = await call(app, "POST", "/x/connections", {
    name: "narrow",
    direct: true,
    can: { dev: ["read", "post"] },
  });
  const { secret } = (await issue.json()) as OutputOf<typeof createConnection>;
  for (const [path, body] of [
    ["/tasks/2/claim", {}],
    ["/tasks", { channel: "dev", text: "x", claim: true }],
  ] as const) {
    const response = await app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  }
});

test("a 60 second lease lasts the requested 60 seconds", async () => {
  app = makeApp();
  await call(app, "POST", "/tasks", { channel: "dev", text: "quick task" });
  const response = await call(app, "POST", "/tasks/2/claim", { lease: 60 });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ claim: { until: "2023-11-14T22:14:20.000Z" } });
});

test("starting or adopting a task with claim and lease honors the requested lease", async () => {
  app = makeApp();
  await call(app, "POST", "/messages", { channel: "dev", text: "adopt with lease" });
  for (const input of [{ channel: "dev", text: "quick create" }, { re: "2" }]) {
    const response = await call(app, "POST", "/tasks", { ...input, claim: true, lease: 60 });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      task: { task: { state: "claimed" } },
      claim: { epoch: 1, until: "2023-11-14T22:14:20.000Z" },
    });
  }
});

test("adding claim to an existing ready task's client ID does not report success", async () => {
  app = makeApp();
  const request = { channel: "dev", text: "keyed task", id: "keyed-task" };
  await call(app, "POST", "/tasks", request);
  const response = await call(app, "POST", "/tasks", { ...request, claim: true });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "duplicate_id" } });
});
