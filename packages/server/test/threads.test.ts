import { afterEach, describe, expect, test } from "bun:test";
import { call, makeApp } from "./support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

interface Thread {
  readonly message: Readonly<Record<string, unknown>>;
  readonly replies: readonly unknown[];
}

describe("reading a thread by its ID", () => {
  test("answers 200 with the message and no replies", async () => {
    app = makeApp();
    const posted = await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const { message } = (await posted.json()) as Thread;
    await call(app, "POST", "/messages", { channel: "dev", text: "another thread" });
    const read = await call(app, "GET", `/messages/${message.id}`);
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toStartWith("application/json");
    expect(await read.json()).toEqual({ message, replies: [] });
  });
});

describe("reading a message that does not exist", () => {
  test("answers 404 message_not_found for an ID past the last message", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const read = await call(app, "GET", "/messages/9999");
    expect(read.status).toBe(404);
    expect(await read.json()).toMatchObject({
      error: { code: "message_not_found", message: "Couldn't find message #9999." },
    });
  });

  test("answers 404 message_not_found, not 400, for an ID that is not a number", async () => {
    app = makeApp();
    const read = await call(app, "GET", "/messages/no-such-message");
    expect(read.status).toBe(404);
    expect(await read.json()).toMatchObject({ error: { code: "message_not_found" } });
  });
});

test("GET /threads answers an empty channel with the board cursor", async () => {
  app = makeApp();
  await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
  const read = await call(app, "GET", "/threads?channel=ops");
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual({ threads: [], cursor: "2", older: null });
});

test("GET /threads combines repeated label filters with labels from the root and a reply", async () => {
  app = makeApp();
  const posted = await call(app, "POST", "/messages", { channel: "dev", text: "root", labels: { area: "api" } });
  const { message } = (await posted.json()) as Thread;
  await call(app, "POST", "/messages", { re: message.id, text: "matching reply", labels: { status: "open" } });
  const latest = await call(app, "POST", "/messages", { re: message.id, text: "latest reply" });
  await call(app, "POST", "/messages", { channel: "dev", text: "different area", labels: { status: "open" } });

  const read = await call(app, "GET", "/threads?channel=dev&label=area&label=status%3Ddraft%7Copen%7C%00");
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({
    threads: [{ message, replies: 2, last: ((await latest.json()) as Thread).message }],
  });
});

test("GET /messages/:id rejects a cursor outside the requested thread", async () => {
  app = makeApp();
  const posted = await call(app, "POST", "/messages", { channel: "dev", text: "root" });
  const outside = await call(app, "POST", "/messages", { channel: "dev", text: "different thread" });
  const { message } = (await posted.json()) as Thread;
  const { message: foreign } = (await outside.json()) as Thread;
  const read = await call(app, "GET", `/messages/${message.id}?after=${foreign.id}`);

  expect(read.status).toBe(400);
  expect(await read.json()).toMatchObject({ error: { code: "invalid_request" } });
});

describe("paging back through a channel's threads", () => {
  test("GET /threads?limit=2 then before=<older> lists every thread once and ends with older null", async () => {
    app = makeApp();
    const ids: string[] = [];
    for (const text of ["one", "two", "three", "four", "five"]) {
      const posted = await call(app, "POST", "/messages", { channel: "dev", text });
      ids.push(((await posted.json()) as Thread).message.id as string);
    }
    const seen: string[] = [];
    let page = (await (await call(app, "GET", "/threads?channel=dev&limit=2")).json()) as {
      threads: Thread[];
      older: string | null;
    };
    expect(page.older).toBe(`${ids[3]}.${ids[3]}`);
    seen.unshift(...page.threads.map(({ message }) => message.id as string));
    while (page.older !== null) {
      const read = await call(app, "GET", `/threads?channel=dev&limit=2&before=${page.older}`);
      expect(read.status).toBe(200);
      page = (await read.json()) as typeof page;
      seen.unshift(...page.threads.map(({ message }) => message.id as string));
    }
    expect(seen).toEqual(ids);
  });

  test("GET /threads without before answers older null when every thread fits", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "only" });
    expect(await (await call(app, "GET", "/threads?channel=dev")).json()).toMatchObject({ older: null });
  });

  test.each([["790"], ["a.b"], ["3.4"], ["1.2.3"], ["99.2"]])(
    "GET /threads answers 400 invalid_cursor for before=%s, which no page gave as its older",
    async (before) => {
      app = makeApp();
      await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
      const read = await call(app, "GET", `/threads?channel=dev&before=${before}`);
      expect(read.status).toBe(400);
      expect(await read.json()).toMatchObject({ error: { code: "invalid_cursor" } });
    },
  );
});
