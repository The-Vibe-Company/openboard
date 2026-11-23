import { afterEach, describe, expect, test } from "bun:test";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, OWNER } from "./support/app.ts";

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
  test("answers 201 with the message at position 2, after the writer's actor.seen at 1", async () => {
    app = makeApp();
    const { status, type, body } = await answer(call(app, "POST", "/messages", { channel: "dev", text: "hello" }));
    expect(status).toBe(201);
    expect(type).toStartWith("application/json");
    expect(body.message).toMatchObject({
      id: "2",
      channel: "dev",
      text: "hello",
      re: null,
      thread: "2",
      by: { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null },
      createdAt: "2023-11-14T22:13:20.000Z",
      version: 2,
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
      ["2", "hello"],
      ["3", "again"],
    ]);
    expect(body.cursor).toBe("3");
  });
});

describe("reading a channel's newest messages", () => {
  test("lists the newest `limit` of five, oldest first, and their cursor reads on to what is posted next", async () => {
    app = makeApp();
    for (const text of ["a", "b", "c"]) await call(app, "POST", "/messages", { channel: "dev", text });
    await call(app, "POST", "/messages", { channel: "ops", text: "elsewhere" });
    for (const text of ["d", "e"]) await call(app, "POST", "/messages", { channel: "dev", text });
    const newest = await answer(call(app, "GET", "/messages?channel=dev&limit=2"));
    expect(newest.status).toBe(200);
    expect([newest.body.messages.map((message) => [message.id, message.text]), newest.body.cursor]).toEqual([
      [
        ["6", "d"],
        ["7", "e"],
      ],
      "7",
    ]);
    const caughtUp = (await answer(call(app, "GET", `/messages?channel=dev&after=${newest.body.cursor}&limit=2`))).body;
    expect([caughtUp.messages, caughtUp.cursor]).toEqual([[], "7"]);
    await call(app, "POST", "/messages", { channel: "dev", text: "f" });
    const next = (await answer(call(app, "GET", `/messages?channel=dev&after=${newest.body.cursor}&limit=2`))).body;
    expect([next.messages.map((message) => message.text), next.cursor]).toEqual([["f"], "8"]);
  });

  test("answers an empty page with cursor 0 for a channel nobody has posted in", async () => {
    app = makeApp();
    const quiet = (await answer(call(app, "GET", "/messages?channel=quiet&limit=2"))).body;
    expect([quiet.messages, quiet.cursor]).toEqual([[], "0"]);
  });
});

describe("reading a channel on from a cursor", () => {
  test.each(["abc", "", "-1", "1e0", "1%0A", "999999"])("answers 400 invalid_cursor for after=%s", async (after) => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const { status, body } = await answer(call(app, "GET", `/messages?channel=dev&after=${after}`));
    expect([status, body.error?.code]).toEqual([400, "invalid_cursor"]);
  });

  test("lists the first `limit` messages after the cursor, and reading on from its cursor repeats and skips none", async () => {
    app = makeApp();
    for (const text of ["a", "b"]) await call(app, "POST", "/messages", { channel: "dev", text });
    await call(app, "POST", "/messages", { channel: "ops", text: "elsewhere" });
    await call(app, "POST", "/messages", { re: "2", text: "c" });
    const first = await answer(call(app, "GET", "/messages?channel=dev&after=2&limit=1"));
    expect(first.status).toBe(200);
    expect([first.body.messages.map((message) => message.id), first.body.cursor]).toEqual([["3"], "3"]);
    const rest = (await answer(call(app, "GET", `/messages?channel=dev&after=${first.body.cursor}&limit=1`))).body;
    expect([rest.messages.map((message) => [message.id, message.text]), rest.cursor]).toEqual([[["5", "c"]], "5"]);
    const end = (await answer(call(app, "GET", `/messages?channel=dev&after=${rest.cursor}`))).body;
    expect([end.messages, end.cursor]).toEqual([[], "5"]);
  });

  test("reads a quiet channel from its first message once it has one, after the cursor its empty page answered", async () => {
    app = makeApp();
    const { cursor } = (await answer(call(app, "GET", "/messages?channel=dev"))).body;
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const { body } = await answer(call(app, "GET", `/messages?channel=dev&after=${cursor}`));
    expect([body.messages.map((message) => message.id), body.cursor]).toEqual([["2"], "2"]);
  });
});

describe("replying in a thread", () => {
  test("answers 201 with the reply in the root's thread, which reads it under the root", async () => {
    app = makeApp();
    const root = (await answer(call(app, "POST", "/messages", { channel: "dev", text: "hello" }))).body.message;
    const posted = await answer(call(app, "POST", "/messages", { re: "2", text: "on it" }));
    expect(posted.status).toBe(201);
    expect(posted.body.message).toMatchObject({ id: "3", channel: "dev", text: "on it", re: "2", thread: "2" });
    const thread = await (await call(app, "GET", "/messages/2")).json();
    expect(thread).toEqual({ message: root, replies: [posted.body.message] });
  });

  test("lists the reply in its root's channel, after the root", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    await call(app, "POST", "/messages", { re: "2", text: "on it" });
    const { body } = await answer(call(app, "GET", "/messages?channel=dev"));
    expect(body.messages.map((message) => [message.id, message.text])).toEqual([
      ["2", "hello"],
      ["3", "on it"],
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
    expect(body.messages.map((message) => message.id)).toEqual(["2"]);
  });

  test("puts a reply to a reply in the root's thread, with the reply it answered as replyTo", async () => {
    app = makeApp();
    const root = (await answer(call(app, "POST", "/messages", { channel: "dev", text: "hello" }))).body.message;
    const first = (await answer(call(app, "POST", "/messages", { re: "2", text: "on it" }))).body.message;
    const deeper = await answer(call(app, "POST", "/messages", { re: "3", text: "deeper" }));
    expect(deeper.status).toBe(201);
    expect(deeper.body.message).toMatchObject({ id: "4", channel: "dev", re: "2", replyTo: "3", thread: "2" });
    const thread = await (await call(app, "GET", "/messages/2")).json();
    expect(thread).toEqual({ message: root, replies: [first, deeper.body.message] });
  });

  test("names the field a reply gets wrong, not the channel it leaves out", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const refused = await answer(call(app, "POST", "/messages", { re: "2", text: "x", sync: ["somewhere"] }));
    expect([refused.status, refused.body.error.code]).toEqual([400, "invalid_request"]);
    expect(refused.body.error.message).toStartWith("sync");
  });

  test("answers 400 invalid_request for a post that names both a channel and re", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const refused = await answer(call(app, "POST", "/messages", { channel: "dev", re: "2", text: "x" }));
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

describe("posting once for a client ID", () => {
  test("answers a retry with the post that landed, whatever its text says, and posts it once", async () => {
    app = makeApp();
    const first = await answer(call(app, "POST", "/messages", { channel: "dev", text: "deploy", id: "deploy-1" }));
    const again = await answer(call(app, "POST", "/messages", { channel: "dev", text: "changed", id: "deploy-1" }));
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(again.body.message).toEqual(first.body.message);
    const { body } = await answer(call(app, "GET", "/messages?channel=dev"));
    expect(body.messages.map((message) => [message.id, message.text])).toEqual([["2", "deploy"]]);
    const feed = (await (await call(app, "GET", "/events?after=0")).json()) as { events: { payload: object }[] };
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0]?.payload).not.toHaveProperty("clientId");
  });

  test("answers a retried reply with the reply that landed", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const first = await answer(call(app, "POST", "/messages", { re: "2", text: "on it", id: "r-1" }));
    const again = await answer(call(app, "POST", "/messages", { re: "2", text: "on it", id: "r-1" }));
    expect(again.body.message).toEqual(first.body.message);
    const thread = (await (await call(app, "GET", "/messages/2")).json()) as { replies: unknown[] };
    expect(thread.replies).toHaveLength(1);
  });

  test("answers 409 duplicate_id for the same ID in another channel, thread, or from another profile", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "deploy", id: "deploy-1" });
    const elsewhere = await answer(call(app, "POST", "/messages", { channel: "ops", text: "deploy", id: "deploy-1" }));
    const asReply = await answer(call(app, "POST", "/messages", { re: "2", text: "deploy", id: "deploy-1" }));
    const headers = { authorization: `Bearer ${OWNER.token}`, "content-type": "application/json" };
    const init = { method: "POST", body: JSON.stringify({ channel: "dev", text: "deploy", id: "deploy-1" }) };
    const request = new Request(`${BOARD_URL}/messages`, {
      ...init,
      headers: { ...headers, "x-board-profile": "bot" },
    });
    const asProfile = await answer(app.fetch(request));
    for (const refused of [elsewhere, asReply, asProfile]) {
      expect([refused.status, refused.body.error.code]).toEqual([409, "duplicate_id"]);
    }
    const { body } = await answer(call(app, "GET", "/messages?channel=dev"));
    expect(body.messages.map((message) => message.id)).toEqual(["2"]);
  });

  test("answers 400 invalid_request for an ID that is the board's, a sync's, or another key's", async () => {
    app = makeApp();
    for (const id of [
      "0f0f0f0f-0f0f-8f0f-8f0f-0f0f0f0f0f0f",
      "sync:chat:1",
      `key:other:${"a".repeat(32)}`,
      "",
      "a\u0000b",
    ]) {
      const refused = await answer(call(app, "POST", "/messages", { channel: "dev", text: "x", id }));
      expect([refused.status, refused.body.error.code]).toEqual([400, "invalid_request"]);
    }
    const own = await answer(
      call(app, "POST", "/messages", { channel: "dev", text: "x", id: `key:${LOCAL_OWNER}:${"a".repeat(32)}` }),
    );
    expect(own.status).toBe(201);
  });
});

describe("reading a post by client ID", () => {
  test("returns the original message without its replies to the author", async () => {
    app = makeApp();
    const id = "deploy/1".padEnd(200, "x");
    const post = await answer(call(app, "POST", "/messages", { channel: "dev", text: "deploy", id }));
    expect(post.status).toBe(201);
    await call(app, "POST", "/messages", { re: post.body.message.id, text: "done" });
    const found = await call(app, "GET", `/posts/${encodeURIComponent(id)}`);
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ message: post.body.message });
  });

  test("returns the same 404 for another principal's post and an unknown client ID", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "deploy", id: "deploy-1" });
    const connection = await call(app, "POST", "/x/connections", { name: "reader", direct: true, can: { "*": "all" } });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as { secret: string };
    const foreign = await answer(
      app.fetch(new Request(`${BOARD_URL}/posts/deploy-1`, { headers: { authorization: `Bearer ${secret}` } })),
    );
    expect([foreign.status, foreign.body.error.code]).toEqual([404, "post_not_found"]);
    for (const id of ["unknown", "x".repeat(201), "%00"]) {
      expect(await answer(call(app, "GET", `/posts/${id}`))).toEqual(foreign);
    }
  });
});
