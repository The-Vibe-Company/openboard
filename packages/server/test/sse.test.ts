import { expect, test } from "bun:test";
import { BOARD_URL, call, makeApp, NOW, OWNER } from "./support/app.ts";
import { openStore } from "./support/drivers.ts";

function subscribe(
  app: ReturnType<typeof makeApp>,
  query = "?channel=dev",
  signal?: AbortSignal,
  lastEventId?: string,
) {
  return app.fetch(
    new Request(`${BOARD_URL}/events${query}`, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${OWNER.token}`,
        ...(lastEventId === undefined ? {} : { "last-event-id": lastEventId }),
      },
      signal,
    }),
  );
}

test("streams new matching posts in order and sends a bare cursor for filtered events", async () => {
  const app = makeApp();
  const response = await subscribe(app);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frame = async () => decoder.decode((await reader.read()).value);
  try {
    expect(await frame()).toBe(": connected\n\n");
    expect(await frame()).toBe("id: 0\n\n");

    expect((await call(app, "POST", "/messages", { channel: "other", text: "filtered" })).status).toBe(201);
    expect(await frame()).toBe("id: 2\n\n");

    for (const [cursor, text] of [
      ["3", "first"],
      ["4", "second"],
    ] as const) {
      expect((await call(app, "POST", "/messages", { channel: "dev", text })).status).toBe(201);
      const [id, name, data] = (await frame()).split("\n");
      expect(id).toBe(`id: ${cursor}`);
      expect(name).toBe("event: board");
      expect(JSON.parse(data!.slice("data: ".length))).toMatchObject({
        cursor,
        type: "message.posted",
        message: { id: cursor, channel: "dev", text },
      });
    }
  } finally {
    await reader.cancel();
    await app.close();
  }
});

test.each([
  ["?channel=dev", "3", ["4", "5"]],
  ["?channel=dev&last=1", "3", ["4", "5"]],
  ["?channel=dev&after=4", "3", ["5"]],
] as const)("opens %s with Last-Event-ID %s at the expected cursor", async (query, lastEventId, ids) => {
  const app = makeApp();
  try {
    for (const text of ["before", "seen", "missed first", "missed second"]) {
      expect((await call(app, "POST", "/messages", { channel: "dev", text })).status).toBe(201);
    }
    const response = await subscribe(app, query, undefined, lastEventId);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    try {
      const decoder = new TextDecoder();
      expect(decoder.decode((await reader.read()).value)).toBe(": connected\n\n");
      const page = decoder.decode((await reader.read()).value);
      expect(Array.from(page.matchAll(/^id: (.+)$/gm), ([, id]) => id)).toEqual([...ids]);
      expect(Array.from(page.matchAll(/^event: board$/gm))).toHaveLength(ids.length);
    } finally {
      await reader.cancel();
    }
  } finally {
    await app.close();
  }
});

test.each([
  ["?channel=dev", "invalid", "invalid_cursor"],
  ["?channel=dev", "1", "invalid_cursor"],
  ["?channel=dev&last=1&wait=0", "0", "invalid_request"],
] as const)("rejects %s with Last-Event-ID %s before opening a stream", async (query, lastEventId, code) => {
  const app = makeApp();
  try {
    const response = await subscribe(app, query, undefined, lastEventId);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code } });
  } finally {
    await app.close();
  }
});

test("ends a pending stream read when the request aborts", async () => {
  const app = makeApp();
  const abort = new AbortController();
  const response = await subscribe(app, "", abort.signal);
  const reader = response.body!.getReader();
  try {
    await reader.read();
    await reader.read();
    const waiting = reader.read();
    abort.abort();
    expect(await waiting).toEqual({ done: true, value: undefined });
  } finally {
    await reader.cancel();
    await app.close();
  }
});

test("returns JSON errors before opening a stream", async () => {
  const app = makeApp();
  try {
    const invalid = await subscribe(app, "?after=1");
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_cursor" } });
    const anonymous = await app.fetch(new Request(`${BOARD_URL}/events`, { headers: { accept: "text/event-stream" } }));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "unauthorized" } });
  } finally {
    await app.close();
  }
});

test("rechecks an author registered during the first newest-page scan", async () => {
  const store = openStore(() => NOW);
  const lookedUp = Promise.withResolvers<void>();
  const continueRead = Promise.withResolvers<void>();
  const app = makeApp({
    store: {
      ...store,
      board(scope) {
        const board = store.board(scope);
        return new Proxy(board, {
          get(target, key) {
            if (key !== "findFilterActors") return Reflect.get(target, key);
            return async (...args: Parameters<typeof board.findFilterActors>) => {
              const actors = await board.findFilterActors(...args);
              lookedUp.resolve();
              await continueRead.promise;
              return actors;
            };
          },
        });
      },
    },
  });
  try {
    const pending = subscribe(app, "?channel=dev&last=1&by=local-test");
    await lookedUp.promise;
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "first by this author" })).status).toBe(201);
    continueRead.resolve();
    const response = await pending;
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    try {
      await reader.read();
      expect(new TextDecoder().decode((await reader.read()).value)).toStartWith("id: 2\nevent: board\n");
    } finally {
      await reader.cancel();
    }
  } finally {
    continueRead.resolve();
    await app.close();
  }
});
