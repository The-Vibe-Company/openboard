import { afterEach, describe, expect, test } from "bun:test";
import { call, LOCAL_OWNER, makeApp } from "./support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

/** The parts of an answer these tests read: a message, a page, or an error envelope. */
interface Body {
  readonly message: Readonly<Record<string, unknown>>;
  readonly messages: readonly { readonly id: string; readonly text: string }[];
  readonly cursor: string;
  readonly error: { readonly code: string; readonly message: string };
}

async function answer(response: Promise<Response>) {
  const settled = await response;
  return { status: settled.status, type: settled.headers.get("content-type"), body: (await settled.json()) as Body };
}

describe("posting a first message on the local board", () => {
  test("answers 201 with the message at position 1", async () => {
    app = makeApp();
    const { status, type, body } = await answer(call(app, "POST", "/messages", { channel: "dev", text: "hello" }));
    expect(status).toBe(201);
    expect(type).toStartWith("application/json");
    expect(body.message).toMatchObject({
      id: "1",
      channel: "dev",
      text: "hello",
      re: null,
      thread: "1",
      by: { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null },
      createdAt: "2023-11-14T22:13:20.000Z",
      version: 1,
      revision: 0,
    });
  });

  test("reads the channel's messages back, oldest first, with a cursor", async () => {
    app = makeApp();
    for (const text of ["hello", "again"]) await call(app, "POST", "/messages", { channel: "dev", text });
    await call(app, "POST", "/messages", { channel: "ops", text: "elsewhere" });
    const { status, body } = await answer(call(app, "GET", "/messages?channel=dev"));
    expect(status).toBe(200);
    expect(body.messages.map((message) => [message.id, message.text])).toEqual([
      ["1", "hello"],
      ["2", "again"],
    ]);
    expect(body.cursor).toBe("2");
  });

  test("reads the latest `limit` messages, and an empty page for a quiet channel", async () => {
    app = makeApp();
    for (const text of ["a", "b", "c"]) await call(app, "POST", "/messages", { channel: "dev", text });
    const latest = await answer(call(app, "GET", "/messages?channel=dev&limit=2"));
    expect(latest.body.messages.map((message) => message.text)).toEqual(["b", "c"]);
    const quiet = (await answer(call(app, "GET", "/messages?channel=quiet"))).body;
    expect([quiet.messages, quiet.cursor]).toEqual([[], "0"]);
  });
});

describe("replying in a thread", () => {
  test("answers 201 with the reply in the root's thread, which reads it under the root", async () => {
    app = makeApp();
    const root = (await answer(call(app, "POST", "/messages", { channel: "dev", text: "hello" }))).body.message;
    const posted = await answer(call(app, "POST", "/messages", { re: "1", text: "on it" }));
    expect(posted.status).toBe(201);
    expect(posted.body.message).toMatchObject({ id: "2", channel: "dev", text: "on it", re: "1", thread: "1" });
    const thread = await (await call(app, "GET", "/messages/1")).json();
    expect(thread).toEqual({ message: root, replies: [posted.body.message] });
  });

  test("lists the reply in its root's channel, after the root", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    await call(app, "POST", "/messages", { re: "1", text: "on it" });
    const { body } = await answer(call(app, "GET", "/messages?channel=dev"));
    expect(body.messages.map((message) => [message.id, message.text])).toEqual([
      ["1", "hello"],
      ["2", "on it"],
    ]);
  });

  test.each([
    ["an ID past the last message", "9"],
    ["an ID that is not a number", "no-such-message"],
  ])("answers 404 message_not_found for a reply to %s, and posts nothing", async (_, re) => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const missing = await answer(call(app, "POST", "/messages", { re, text: "x" }));
    expect([missing.status, missing.body.error.code]).toEqual([404, "message_not_found"]);
    const { body } = await answer(call(app, "GET", "/messages?channel=dev"));
    expect(body.messages.map((message) => message.id)).toEqual(["1"]);
  });

  test("answers 400 invalid_request for a post that names both a channel and re", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const refused = await answer(call(app, "POST", "/messages", { channel: "dev", re: "1", text: "x" }));
    expect([refused.status, refused.body.error.code]).toEqual([400, "invalid_request"]);
  });
});

describe("refusing what the contract does not take", () => {
  test.each([
    ["a channel that is not a path", { channel: "Dev Ops", text: "x" }, "channel"],
    ["blank text", { channel: "dev", text: "  " }, "text"],
    ["a field the route does not take", { channel: "dev", text: "x", sync: ["somewhere"] }, "sync"],
    ["a missing channel", { text: "x" }, "channel"],
  ])("answers 400 invalid_request for %s", async (_, body, field) => {
    app = makeApp();
    const refused = await answer(call(app, "POST", "/messages", body));
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("invalid_request");
    expect(refused.body.error.message).toStartWith(field);
  });

  test("answers 400 invalid_request for a body that is not JSON", async () => {
    app = makeApp();
    const refused = await answer(call(app, "POST", "/messages", "{not json"));
    expect([refused.status, refused.body.error.code]).toEqual([400, "invalid_request"]);
  });

  test("answers 400 reserved_label for a label under board.", async () => {
    app = makeApp();
    const refused = await answer(
      call(app, "POST", "/messages", { channel: "dev", text: "x", labels: { "board.task": "y" } }),
    );
    expect([refused.status, refused.body.error.code]).toEqual([400, "reserved_label"]);
  });

  test("answers 400 invalid_request for a read without a channel or with a limit out of range", async () => {
    app = makeApp();
    for (const query of [
      "",
      "?channel=dev&limit=0",
      "?channel=dev&limit=501",
      "?channel=dev&after=1",
      "?channel=dev&limit=1e2",
      "?channel=dev&limit=2.9",
      "?channel=dev&limit=true",
    ]) {
      const refused = await answer(call(app, "GET", `/messages${query}`));
      expect([refused.status, refused.body.error.code]).toEqual([400, "invalid_request"]);
    }
  });
});

describe("answering only for boards and routes that exist", () => {
  test.each([
    ["an unknown organization", "http://127.0.0.1:8787/api/acme/main/messages?channel=dev"],
    ["an unknown board", "http://127.0.0.1:8787/api/local/other/messages?channel=dev"],
    ["an unknown route", "http://127.0.0.1:8787/api/local/main/nowhere"],
    ["a path outside any board", "http://127.0.0.1:8787/elsewhere"],
  ])("answers 404 not_found as JSON for %s", async (_, url) => {
    app = makeApp();
    const missing = await answer(app.fetch(new Request(url)));
    expect([missing.status, missing.body.error.code]).toEqual([404, "not_found"]);
    expect(missing.type).toStartWith("application/json");
  });

  test("answers 500 internal and logs the stack when the store fails", async () => {
    app = makeApp();
    await app.close();
    const failed = await answer(call(app, "POST", "/messages", { channel: "dev", text: "x" }));
    expect([failed.status, failed.body.error.code]).toEqual([500, "internal"]);
    expect(app.logged).toHaveLength(1);
    expect(String(app.logged[0]?.stack)).not.toContain('"text"');
  });
});
