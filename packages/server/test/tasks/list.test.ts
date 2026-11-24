import { afterEach, expect, test } from "bun:test";
import type { listTasks, Message, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

type Page = OutputOf<typeof listTasks>;

async function createTask(channel: string, text: string, labels?: Record<string, string>): Promise<string> {
  const response = await call(app, "POST", "/tasks", { channel, text, ...(labels && { labels }) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { task: Message }).task.id;
}

async function list(query: string): Promise<Page> {
  const response = await call(app, "GET", `/tasks${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
}

const ids = (page: Page) => page.tasks.map(({ message }) => message.id);

test("lists a channel's open tasks oldest first, each with its reply count and latest reply", async () => {
  app = makeApp();
  const a = await createTask("dev", "a");
  const b = await createTask("dev", "b");
  const reply = await call(app, "POST", "/messages", { re: a, text: "started" });
  const started = ((await reply.json()) as { message: Message }).message;
  await call(app, "POST", "/messages", { channel: "dev", text: "a thread, not a task" });
  const page = await list("?channel=dev");
  expect(ids(page)).toEqual([a, b]);
  expect(page.tasks[0]).toMatchObject({ replies: 1, last: { id: started.id, text: "started" } });
  expect(page.tasks[0]?.message.task?.state).toBe("ready");
  expect(page.tasks[1]).toMatchObject({ replies: 0, last: null });
  const head = await call(app, "GET", "/events");
  expect(page.cursor).toBe(((await head.json()) as { cursor: string }).cursor);
});

test("pages by cursor: a full page goes on after its last task", async () => {
  app = makeApp();
  const a = await createTask("dev", "a");
  const b = await createTask("dev", "b");
  const first = await list("?channel=dev&limit=1");
  expect(ids(first)).toEqual([a]);
  expect(first.cursor).toBe(a);
  const second = await list(`?channel=dev&limit=1&after=${first.cursor}`);
  expect(ids(second)).toEqual([b]);
  expect(ids(await list(`?channel=dev&limit=1&after=${second.cursor}`))).toEqual([]);
  const ahead = await call(app, "GET", "/tasks?after=999");
  expect(ahead.status).toBe(400);
  expect(await ahead.json()).toMatchObject({ error: { code: "invalid_cursor" } });
});

test("lists a subtree, the whole board, one state, or tasks with a label", async () => {
  app = makeApp();
  const dev = await createTask("dev", "dev", { k: "v" });
  const web = await createTask("dev/web", "web", { k: "w" });
  const ops = await createTask("ops", "ops");
  expect(ids(await list("?channel=dev/"))).toEqual([dev, web]);
  expect(ids(await list("?state=all"))).toEqual([dev, web, ops]);
  expect(ids(await list("?state=ready&label=k=v"))).toEqual([dev]);
  expect(ids(await list("?state=completed"))).toEqual([]);
  expect(ids(await list("?by=me&owner=nobody"))).toEqual([]);
  const wrong = await call(app, "GET", "/tasks?state=done");
  expect(wrong.status).toBe(400);
  expect(await wrong.json()).toMatchObject({ error: { code: "invalid_request" } });
});

test("a caller lists tasks only where it reads throughout", async () => {
  app = makeApp();
  const dev = await createTask("dev", "dev");
  await createTask("dev/secret", "secret");
  const issued = await call(app, "POST", "/x/connections", {
    name: "reader",
    direct: true,
    can: { dev: ["read"] },
  });
  expect(issued.status).toBe(201);
  const { secret } = (await issued.json()) as { secret: string };
  const as = (query: string) =>
    app.fetch(new Request(`${BOARD_URL}/tasks${query}`, { headers: { authorization: `Bearer ${secret}` } }));
  const own = await as("?channel=dev");
  expect(own.status).toBe(200);
  expect(ids((await own.json()) as Page)).toEqual([dev]);
  for (const query of ["", "?channel=dev/", "?channel=ops"]) {
    const refused = await as(query);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "forbidden" } });
  }
});
