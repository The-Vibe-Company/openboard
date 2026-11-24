import { afterEach, expect, test } from "bun:test";
import type { Message, OutputOf, readEvents } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

async function postOnlyHeaders() {
  const connection = await call(app, "POST", "/x/connections", {
    name: "poster",
    direct: true,
    can: { dev: ["post"] },
  });
  expect(connection.status).toBe(201);
  const { secret } = (await connection.json()) as { secret: string };
  return { authorization: `Bearer ${secret}`, "content-type": "application/json" };
}

test("concurrent creates under one client ID return the same task and append one creation", async () => {
  app = makeApp();
  const command = { channel: "dev", text: "deploy", id: "deploy-42" };
  const results = await Promise.all([call(app, "POST", "/tasks", command), call(app, "POST", "/tasks", command)]);
  expect(results.map(({ status }) => status)).toEqual([201, 201]);
  const [first, second] = await Promise.all(results.map((response) => response.json()));
  expect(first).toMatchObject({ task: { text: "deploy", task: { state: "ready" } } });
  expect(second).toEqual(first);
  const { events } = (await (await call(app, "GET", "/events?after=0&all=true")).json()) as OutputOf<typeof readEvents>;
  expect(events.map(({ type }) => type)).toEqual(["actor.seen", "message.posted", "task.created"]);
});

test("a client ID belonging to a reply or plain thread cannot create a task", async () => {
  app = makeApp();
  const root = await call(app, "POST", "/messages", { channel: "dev", text: "plain", id: "p-1" });
  expect(root.status).toBe(201);
  const { message } = (await root.json()) as { message: Message };
  expect((await call(app, "POST", "/messages", { re: message.id, text: "reply", id: "r-1" })).status).toBe(201);
  const before = (await (await call(app, "GET", "/events?after=0&all=true")).json()) as OutputOf<typeof readEvents>;
  for (const id of ["p-1", "r-1"]) {
    const response = await call(app, "POST", "/tasks", { channel: "dev", text: "deploy", id });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "duplicate_id" } });
  }
  const read = await call(app, "GET", `/messages/${message.id}`);
  expect(((await read.json()) as { message: Message }).message).toEqual(message);
  expect(await (await call(app, "GET", "/events?after=0&all=true")).json()).toEqual(before);
});

test("adopting a thread refuses a client ID and leaves the thread plain", async () => {
  app = makeApp();
  const root = await call(app, "POST", "/messages", { channel: "dev", text: "plain" });
  const { message } = (await root.json()) as { message: Message };
  const response = await call(app, "POST", "/tasks", { re: message.id, id: "deploy-42" });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
  const read = await call(app, "GET", `/messages/${message.id}`);
  expect(((await read.json()) as { message: Message }).message).toEqual(message);
});

test("a post-only writer recovers only the task it originally created", async () => {
  app = makeApp();
  const headers = await postOnlyHeaders();
  const command = { channel: "dev", text: "deploy", id: "deploy-42" };
  const create = (route: string) =>
    app.fetch(new Request(`${BOARD_URL}${route}`, { method: "POST", headers, body: JSON.stringify(command) }));
  const first = await create("/tasks");
  expect(first.status).toBe(201);
  const { task } = (await first.json()) as { task: Message };
  expect((await call(app, "POST", `/messages/${task.id}/labels`, { set: { private: "label" } })).status).toBe(200);
  const { events } = (await (await call(app, "GET", "/events?after=0")).json()) as OutputOf<typeof readEvents>;
  const creation = events.find(({ type }) => type === "task.created");
  expect(creation).toBeDefined();
  const current = await call(app, "GET", `/messages/${task.id}`);
  expect(await current.json()).toMatchObject({ message: { labels: { private: "label" } } });
  expect(creation?.payload).not.toHaveProperty("blind");
  const replay = await create("/tasks");
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual({ task });
  const post = await create("/messages");
  expect(post.status).toBe(201);
  expect(await post.json()).toEqual({ message: task });
  const recovered = await app.fetch(new Request(`${BOARD_URL}/posts/deploy-42`, { headers }));
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual({ message: task });
});

test("adoption preserves a post-only writer's original plain post under its key", async () => {
  app = makeApp();
  const headers = await postOnlyHeaders();
  const command = { channel: "dev", text: "plain", id: "p-1" };
  const create = (route: string) =>
    app.fetch(new Request(`${BOARD_URL}${route}`, { method: "POST", headers, body: JSON.stringify(command) }));
  const post = await create("/messages");
  expect(post.status).toBe(201);
  const { message } = (await post.json()) as { message: Message };
  expect((await call(app, "POST", "/tasks", { re: message.id })).status).toBe(201);
  const replay = await create("/messages");
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual({ message });
  const recovered = await app.fetch(new Request(`${BOARD_URL}/posts/p-1`, { headers }));
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual({ message });
  const task = await create("/tasks");
  expect(task.status).toBe(409);
  expect(await task.json()).toMatchObject({ error: { code: "duplicate_id" } });
});
