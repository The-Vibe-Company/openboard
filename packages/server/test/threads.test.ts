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
  expect(await read.json()).toEqual({ threads: [], cursor: "2" });
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
