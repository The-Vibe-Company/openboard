import { expect, test } from "bun:test";
import type { OutputOf, postMessage } from "@openboard/contract";
import type { BoardView, Store } from "@openboard/ports";
import type { App } from "../../src/index.ts";
import { call, makeApp, NOW, OWNER, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

function waitFixture() {
  const parked = Promise.withResolvers<void>();
  const deadline = Promise.withResolvers<{ delay: number; expire: () => void }>();
  const store = openStore(() => NOW);
  const board: Store["board"] = (scope) => {
    const view = store.board(scope);
    return new Proxy(view, {
      get(target, key) {
        if (key !== "readEvents") return Reflect.get(target, key);
        return async (...args: Parameters<BoardView["readEvents"]>) => {
          const page = await target.readEvents(...args);
          // Let the local-owner authorization and empty-page handling finish before writing or expiring.
          if (page.events.length === 0 && page.cursor === page.head) setImmediate(parked.resolve);
          return page;
        };
      },
    });
  };
  const app = makeApp({
    store: { ...store, board },
    schedule(delay, expire) {
      deadline.resolve({ delay, expire });
      return () => {};
    },
  });
  return { app, parked: parked.promise, deadline: deadline.promise };
}

async function post(app: App, body: { channel: string; text: string } | { re: string; text: string }) {
  const response = await call(app, "POST", "/messages", body);
  expect(response.status).toBe(201);
  return ((await response.json()) as OutputOf<typeof postMessage>).message.id;
}

function readEvents(app: App, re: string, wait: number) {
  return app.fetch(
    new Request(`${PUBLIC_URL}/mcp/local/main`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${OWNER.token}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "read_events", arguments: { re, after: re, wait } },
      }),
    }),
  );
}

async function untilParked(parked: Promise<void>, pending: Promise<Response>) {
  await Promise.race([
    parked,
    pending.then(() => {
      throw new Error("read_events returned before parking");
    }),
  ]);
}

test("MCP read_events wakes on a reply to the requested thread", async () => {
  const { app, parked } = waitFixture();
  const [reader, writer = reader] = app.instances;
  if (!reader || !writer) throw new Error("expected server instances");
  try {
    const root = await post(writer, { channel: "dev", text: "root" });
    expect(root).toBe("2");
    // The initial scan must advance past this unrelated post and still park.
    await post(writer, { channel: "dev", text: "outside the thread" });
    const pending = readEvents(reader, root, 25);
    await untilParked(parked, pending);
    const reply = await post(writer, { re: root, text: "reply" });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: {
        structuredContent: {
          cursor: reply,
          events: [{ cursor: reply, type: "message.posted", message: { id: reply, re: root, text: "reply" } }],
        },
      },
    });
  } finally {
    await app.close();
  }
});

test.each([25, 300])("MCP read_events with wait=%i returns the same cursor at 25 seconds", async (wait) => {
  const { app, parked, deadline } = waitFixture();
  const [reader] = app.instances;
  if (!reader) throw new Error("expected a server instance");
  try {
    const root = await post(reader, { channel: "dev", text: "root" });
    const pending = readEvents(reader, root, wait);
    await untilParked(parked, pending);
    const { delay, expire } = await deadline;
    expect(delay).toBe(25_000);
    expire();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { structuredContent: { cursor: root, events: [] } },
    });
  } finally {
    await app.close();
  }
});
