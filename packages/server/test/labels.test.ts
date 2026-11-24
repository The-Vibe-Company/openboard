import { afterEach, describe, expect, test } from "bun:test";
import { call, makeApp } from "./support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

/** The root message as its thread reads it now. */
async function root(id = "2") {
  const body = (await (await call(app, "GET", `/messages/${id}`)).json()) as {
    message: { version: number; revision: number; labels: Record<string, string>; text: string };
  };
  return body.message;
}

async function refusal(response: Promise<Response>) {
  const settled = await response;
  const body = (await settled.json()) as { error: { code: string; message: string } };
  return [settled.status, body.error.code];
}

describe("labeling a message", () => {
  test("sets each label to one value, keeps the others, and raises the version, not the revision", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "deploy", labels: { status: "open", repo: "web" } });
    const before = await root();
    const labeled = await call(app, "POST", "/messages/2/labels", { set: { status: "done", owner: "me" } });
    expect([labeled.status, await labeled.json()]).toEqual([200, { ok: true }]);
    const after = await root();
    expect(after).toMatchObject({ labels: { status: "done", repo: "web", owner: "me" }, revision: 0, version: 3 });
    expect(after.version).toBeGreaterThan(before.version);
    const listed = (await (await call(app, "GET", "/messages?channel=dev")).json()) as { messages: unknown[] };
    expect(listed.messages).toEqual([after]);
  });

  test("raises the version with each edit, reaction, and label, as upstream's conformance check reads it", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "a root" });
    let before = await root();
    for (const [path, body] of [
      ["/messages/2/edit", { text: "an edited root" }],
      ["/messages/2/reactions", { emoji: "eyes" }],
      ["/messages/2/labels", { set: { state: "open" } }],
      ["/messages/2/labels", { set: { state: "open" } }],
    ] as const) {
      expect((await call(app, "POST", path, body)).status).toBe(200);
      const after = await root();
      expect(after.version).toBeGreaterThan(before.version);
      before = after;
    }
    expect(before).toMatchObject({ text: "an edited root", labels: { state: "open" } });
  });

  test("labels a reply in its own view, leaving its root's labels alone", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "a root" });
    await call(app, "POST", "/messages", { re: "2", text: "a reply" });
    await call(app, "POST", "/messages/3/labels", { set: { status: "done" } });
    const thread = (await (await call(app, "GET", "/messages/2")).json()) as {
      message: { labels: object };
      replies: { labels: object }[];
    };
    expect(thread.message.labels).toEqual({});
    expect(thread.replies.map((reply) => reply.labels)).toEqual([{ status: "done" }]);
  });

  test("answers 404 message_not_found for a missing message and 400 message_deleted for a deleted one", async () => {
    app = makeApp();
    expect(await refusal(call(app, "POST", "/messages/2/labels", { set: { a: "1" } }))).toEqual([
      404,
      "message_not_found",
    ]);
    await call(app, "POST", "/messages", { channel: "dev", text: "gone soon" });
    await call(app, "POST", "/messages/2/delete");
    expect(await refusal(call(app, "POST", "/messages/2/labels", { set: { a: "1" } }))).toEqual([
      400,
      "message_deleted",
    ]);
  });

  test.each([
    ["a label under board.", { set: { "board.task": "ready" } }, "reserved_label"],
    ["a malformed key", { set: { Status: "open" } }, "invalid_request"],
    ["a value with a control character", { set: { status: "a\nb" } }, "invalid_request"],
    ["no set", {}, "invalid_request"],
  ])("answers 400 for %s and changes nothing", async (_, body, code) => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    expect(await refusal(call(app, "POST", "/messages/2/labels", body))).toEqual([400, code]);
    expect(await root()).toMatchObject({ labels: {}, version: 2 });
  });
});
