import { afterEach, expect, test } from "bun:test";
import type { Message, OutputOf, readEvents } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp } from "../support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

/** A direct connection's secret, granted `can` in `dev`. */
async function connection(name: string, can: readonly string[]) {
  const issued = await call(app, "POST", "/x/connections", { name, direct: true, can: { dev: can } });
  expect(issued.status).toBe(201);
  return ((await issued.json()) as { secret: string }).secret;
}

function makeTask(secret: string, body: unknown) {
  return app.fetch(
    new Request(`${BOARD_URL}/tasks`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function post(text: string, re?: string) {
  const response = await call(app, "POST", "/messages", re === undefined ? { channel: "dev", text } : { re, text });
  expect(response.status).toBe(201);
  return ((await response.json()) as { message: Message }).message;
}

async function head() {
  return ((await (await call(app, "GET", "/events")).json()) as { cursor: string }).cursor;
}

test("making a task of a thread keeps its root and records the actor that made it one", async () => {
  app = makeApp();
  const root = await post("flaky test in ci");
  const secret = await connection("triage", ["read", "post", "label"]);
  const cursor = await head();
  const response = await makeTask(secret, { re: root.id });
  expect(response.status).toBe(201);
  const { task } = (await response.json()) as { task: Message };
  const by = task.task?.by;
  expect(by).not.toBe(LOCAL_OWNER);
  expect(task).toMatchObject({
    id: root.id,
    thread: root.id,
    text: "flaky test in ci",
    by: root.by,
    createdAt: root.createdAt,
    labels: { "board.task": "ready" },
    task: { state: "ready", by, for: null, needs: [], epoch: 0, claim: null },
  });
  const read = await call(app, "GET", `/messages/${root.id}`);
  expect(((await read.json()) as { message: Message }).message).toEqual(task);
  const feed = await call(app, "GET", `/events?after=${cursor}`);
  const { events } = (await feed.json()) as OutputOf<typeof readEvents>;
  expect(events.map(({ type }) => type)).toEqual(["task.created"]);
  expect(events[0]).toMatchObject({ payload: { id: root.id, thread: root.id, by: { actor: by } }, message: task });
  const listed = await call(app, "GET", "/tasks?channel=dev");
  const { tasks } = (await listed.json()) as { tasks: { message: Message }[] };
  expect(tasks.map(({ message }) => message.id)).toEqual([root.id]);
});

test("a thread that is a task already is 409 already_a_task, and nothing is written", async () => {
  app = makeApp();
  const root = await post("flaky test in ci");
  expect((await call(app, "POST", "/tasks", { re: root.id })).status).toBe(201);
  const started = await call(app, "POST", "/tasks", { channel: "dev", text: "a new task" });
  const { task } = (await started.json()) as { task: Message };
  const cursor = await head();
  for (const id of [root.id, task.id]) {
    const again = await call(app, "POST", "/tasks", { re: id });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "already_a_task" } });
  }
  expect(await head()).toBe(cursor);
});

test("making a task of a thread needs label in its channel, and a refusal leaves it as it was", async () => {
  app = makeApp();
  const root = await post("flaky test in ci");
  const secret = await connection("poster", ["read", "post"]);
  const cursor = await head();
  const response = await makeTask(secret, { re: root.id });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  expect(await head()).toBe(cursor);
  const read = await call(app, "GET", `/messages/${root.id}`);
  expect(((await read.json()) as { message: Message }).message).toEqual(root);
});

test("a deleted thread is 400 message_deleted, and nothing is written", async () => {
  app = makeApp();
  const root = await post("flaky test in ci");
  expect((await call(app, "POST", `/messages/${root.id}/delete`, {})).status).toBe(200);
  const cursor = await head();
  const response = await call(app, "POST", "/tasks", { re: root.id });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "message_deleted" } });
  expect(await head()).toBe(cursor);
});

test.each([
  ["a reply", (reply: string) => ({ re: reply }), 400, "invalid_request"],
  ["a missing message", () => ({ re: "999" }), 404, "message_not_found"],
  ["a thread with new text", (_: string, root: string) => ({ re: root, text: "again" }), 400, "invalid_request"],
  ["a thread with labels", (_: string, root: string) => ({ re: root, labels: { k: "v" } }), 400, "invalid_request"],
  ["a thread and a channel", (_: string, root: string) => ({ re: root, channel: "dev" }), 400, "invalid_request"],
  ["neither a thread nor a channel", () => ({ text: "orphan" }), 400, "invalid_request"],
  ["a channel without text", () => ({ channel: "dev" }), 400, "invalid_request"],
] as const)("making a task of %s is refused", async (_, body, status, code) => {
  app = makeApp();
  const root = await post("flaky test in ci");
  const reply = await post("seen it twice", root.id);
  const cursor = await head();
  const response = await call(app, "POST", "/tasks", body(reply.id, root.id));
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
  expect(await head()).toBe(cursor);
});
