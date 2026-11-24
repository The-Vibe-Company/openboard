import { afterAll, describe, expect, test } from "bun:test";
import { type Headers, seed } from "../isolation/seed.ts";

/**
 * Sync is deferred (D19): every sync route answers as a board with no sync does (docs/protocol.md "Sync (deferred)"),
 * never a 404 that looks like a wrong URL.
 */
const seeded = await seed();
const { a, b } = seeded;
afterAll(async () => {
  await seeded.app.close();
  await seeded.store.close();
});

const base = `/api/${a.org}/${a.board}`;
const message = String(a.ids.message);

async function answer(method: string, path: string, headers: Headers = a.session, body?: unknown) {
  const response = await seeded.send(method, `${base}${path}`, headers, body);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const error = (code: string, message?: string) => ({ error: { code, ...(message ? { message } : {}) } });

/** A direct connection of A's board under `can`, as its owner creates one. */
async function narrowed(name: string, can: Record<string, string[]>): Promise<Headers> {
  const response = await seeded.send("POST", `${base}/x/connections`, a.session, { name, can, direct: true });
  if (response.status !== 201) throw new Error(`connection: ${response.status} ${await response.text()}`);
  const { secret } = (await response.json()) as { secret: string };
  return { authorization: `Bearer ${secret}` };
}

describe("a board that syncs nowhere", () => {
  test("POST /messages/:id/sync answers 404 not_synced_here", async () => {
    const got = await answer("POST", `/messages/${message}/sync`, a.session, { target: "elsewhere" });
    expect(got).toMatchObject({ status: 404, body: error("not_synced_here") });
  });

  test("GET /messages/:id/sync answers no targets", async () => {
    expect(await answer("GET", `/messages/${message}/sync`)).toEqual({ status: 200, body: { targets: [] } });
  });

  test("GET /links answers 404 message_not_found for any link", async () => {
    const got = await answer("GET", `/links?url=${encodeURIComponent("https://example.com/p/1")}`);
    expect(got).toMatchObject({ status: 404, body: error("message_not_found") });
  });

  test("POST /messages/:id/typing answers no targets", async () => {
    const got = await answer("POST", `/messages/${message}/typing`, a.session, { status: "thinking" });
    expect(got).toEqual({ status: 200, body: { targets: [] } });
  });

  test("GET /sources/:key/read and POST /sources/:key/join answer 404 not_synced_here", async () => {
    const read = await answer("GET", "/sources/chat-eu/read?target=general");
    expect(read).toMatchObject({ status: 404, body: error("not_synced_here") });
    const join = await answer("POST", "/sources/chat-eu/join", a.session, { target: "general" });
    expect(join).toMatchObject({ status: 404, body: error("not_synced_here") });
  });

  test("POST /webhooks/:key answers 404 not_found without a token", async () => {
    const got = await answer("POST", "/webhooks/chat-eu", {}, { type: "event_callback" });
    expect(got).toMatchObject({ status: 404, body: error("not_found") });
  });

  test("GET /inbox/:key answers no events with sync in every channel, 403 forbidden otherwise", async () => {
    expect(await answer("GET", "/inbox/chat-eu")).toEqual({ status: 200, body: { events: [] } });
    const syncsEverywhere = await narrowed("syncs-everywhere", { "*": ["read", "sync"] });
    expect(await answer("GET", "/inbox/chat-eu", syncsEverywhere)).toEqual({ status: 200, body: { events: [] } });
    const without = { "no-sync": { "*": ["read", "post"] }, "syncs-in-dev": { "*": ["read"], dev: ["sync"] } };
    for (const [name, can] of Object.entries(without)) {
      const got = await answer("GET", "/inbox/chat-eu", await narrowed(name, can));
      expect(got, JSON.stringify(can)).toMatchObject({ status: 403, body: error("forbidden") });
    }
  });

  test("sync's record routes answer 403 forbidden: this board keeps no sync", async () => {
    const routes: [string, string, unknown?][] = [
      ["POST", "/inbox/chat-eu", { events: [] }],
      ["GET", "/inbox/chat-eu/next"],
      ["POST", "/inbox/chat-eu/evt-1/ack", { lease: "lease-1" }],
      ["POST", "/sync/imports", { op: "post", from: null }],
      ["POST", "/sync/receipts", { kind: "message", message }],
      ["GET", `/sync/threads/${message}`],
      ["GET", "/sync/find?post=evt-1"],
      ["GET", `/sync/copies?message=${message}`],
    ];
    for (const [method, path, body] of routes) {
      const got = await answer(method, path, a.session, body);
      expect(got, `${method} ${path}`).toMatchObject({
        status: 403,
        body: error("forbidden", "this board keeps no sync"),
      });
    }
  });

  test("POST /wake answers 404", async () => {
    expect((await answer("POST", "/wake", a.session, {})).status).toBe(404);
  });
});

describe("message routes read the message first", () => {
  const routes: [string, string, unknown?][] = [
    ["POST", "sync", { target: "elsewhere" }],
    ["GET", "sync"],
    ["POST", "typing", {}],
  ];

  test("an ID that names no message answers 404 message_not_found", async () => {
    for (const [method, route, body] of routes) {
      const got = await answer(method, `/messages/999999/${route}`, a.session, body);
      expect(got, `${method} ${route}`).toMatchObject({ status: 404, body: error("message_not_found") });
    }
  });

  test("another organization's message answers 401 to a board-bound credential and 404 to a session", async () => {
    const theirs = `/api/${b.org}/${b.board}/messages/${String(b.ids.message)}`;
    for (const [method, route, body] of routes) {
      for (const [credential, status, code] of [
        [a.connection, 401, "unauthorized"],
        [a.agent, 401, "unauthorized"],
        [a.session, 404, "not_found"],
        [a.personal, 404, "not_found"],
      ] as const) {
        const response = await seeded.send(method, `${theirs}/${route}`, credential, body);
        expect(response.status, `${method} ${route}`).toBe(status);
        expect(await response.json()).toMatchObject(error(code));
      }
    }
  });

  test("a message in a channel the caller cannot read answers as a missing one", async () => {
    const elsewhere = await narrowed("ops-only", { ops: ["read", "post"] });
    for (const [method, route, body] of routes) {
      const got = await answer(method, `/messages/${message}/${route}`, elsewhere, body);
      expect(got, `${method} ${route}`).toMatchObject({ status: 404, body: error("message_not_found") });
    }
  });
});

test("discovery still answers sync: []", async () => {
  const response = await seeded.send("GET", `${base}/`, {});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ sync: [] });
});
