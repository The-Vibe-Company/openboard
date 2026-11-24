import { expect, test } from "bun:test";
import { BOARD_URL, call, makeApp, NOW, OWNER } from "./support/app.ts";
import { openStore } from "./support/drivers.ts";
import { PING_INTERVAL_MS, STREAM_MAX_MS } from "../src/live/sse.ts";

/** A scheduler the test fires by hand: every stream arms a ping and a deadline timer; no test waits on the wall clock. */
function manualTimers() {
  const pending = new Map<number, { delayMs: number; run: () => void }>();
  let armed = 0;
  return {
    pending,
    schedule(delayMs: number, run: () => void) {
      const id = ++armed;
      pending.set(id, { delayMs, run });
      return () => pending.delete(id);
    },
    /** Fires the timers armed with this delay, as the clock would once it elapses. */
    fire(delayMs = PING_INTERVAL_MS) {
      const due = [...pending].filter(([, timer]) => timer.delayMs === delayMs);
      for (const [id] of due) pending.delete(id);
      for (const [, timer] of due) timer.run();
    },
    delays() {
      return [...pending.values()].map((timer) => timer.delayMs).sort((a, b) => a - b);
    },
  };
}

function streamingApp(options: Parameters<typeof makeApp>[0] = {}) {
  return makeApp({ schedule: manualTimers().schedule, ...options });
}

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
  const app = streamingApp();
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
  const app = streamingApp();
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
  const app = streamingApp();
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
  const app = streamingApp({
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

test("pings a quiet stream every 15 seconds", async () => {
  const timers = manualTimers();
  const app = makeApp({ schedule: timers.schedule });
  const response = await subscribe(app);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frame = async () => decoder.decode((await reader.read()).value);
  try {
    expect(await frame()).toBe(": connected\n\n");
    expect(await frame()).toBe("id: 0\n\n");
    for (let round = 0; round < 2; round++) {
      expect(timers.delays()).toEqual([15_000, 280_000]);
      timers.fire();
      expect(await frame()).toBe(": ping\n\n");
    }
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "after pings" })).status).toBe(201);
    expect(await frame()).toStartWith("id: 2\nevent: board\n");
  } finally {
    await reader.cancel();
    await app.close();
  }
  expect(timers.pending.size).toBe(0);
});

test("skips a ping while the client has a frame left to read", async () => {
  const timers = manualTimers();
  const app = makeApp({ schedule: timers.schedule });
  const response = await subscribe(app);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  try {
    timers.fire();
    expect(decoder.decode((await reader.read()).value)).toBe(": connected\n\n");
    expect(decoder.decode((await reader.read()).value)).toBe("id: 0\n\n");
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "next frame" })).status).toBe(201);
    expect(decoder.decode((await reader.read()).value)).toStartWith("id: 2\nevent: board\n");
    expect(timers.delays()).toEqual([PING_INTERVAL_MS, STREAM_MAX_MS]);
  } finally {
    await reader.cancel();
    await app.close();
  }
});

test("stops pinging when the request aborts", async () => {
  const timers = manualTimers();
  const app = makeApp({ schedule: timers.schedule });
  const abort = new AbortController();
  const response = await subscribe(app, "", abort.signal);
  const reader = response.body!.getReader();
  try {
    await reader.read();
    await reader.read();
    expect(timers.pending.size).toBe(2);
    abort.abort();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(timers.pending.size).toBe(0);
  } finally {
    await reader.cancel();
    await app.close();
  }
});

test("stops pinging when a stream read fails", async () => {
  const timers = manualTimers();
  const store = openStore(() => NOW);
  let reads = 0;
  const app = makeApp({
    schedule: timers.schedule,
    store: {
      ...store,
      board(scope) {
        const board = store.board(scope);
        return new Proxy(board, {
          get(target, key) {
            if (key !== "readEvents") return Reflect.get(target, key);
            return async (...args: Parameters<typeof board.readEvents>) => {
              if (++reads > 1) throw new Error("storage failed");
              return board.readEvents(...args);
            };
          },
        });
      },
    },
  });
  // A text filter matches earlier versions, which only the store holds: the post makes the stream read it.
  const response = await subscribe(app, "?channel=dev&text=hi");
  const reader = response.body!.getReader();
  try {
    await reader.read();
    await reader.read();
    expect(timers.pending.size).toBe(2);
    const failed = reader.read();
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "hi" })).status).toBe(201);
    await expect(failed).rejects.toThrow("storage failed");
    expect(timers.pending.size).toBe(0);
  } finally {
    await app.close();
  }
});

test("ends a stream after about 280 seconds and resumes from its last id without a gap", async () => {
  const timers = manualTimers();
  const app = makeApp({ schedule: timers.schedule });
  const decoder = new TextDecoder();
  try {
    const reader = (await subscribe(app)).body!.getReader();
    const frame = async () => decoder.decode((await reader.read()).value);
    expect(await frame()).toBe(": connected\n\n");
    expect(await frame()).toBe("id: 0\n\n");
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "before the deadline" })).status).toBe(201);
    expect(await frame()).toStartWith("id: 2\nevent: board\n");
    const waiting = reader.read();
    expect(timers.delays()).toEqual([PING_INTERVAL_MS, STREAM_MAX_MS]);
    timers.fire(STREAM_MAX_MS);
    expect(decoder.decode((await waiting).value)).toBe("retry: 100\n\n");
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(timers.pending.size).toBe(0);

    expect((await call(app, "POST", "/messages", { channel: "dev", text: "while away" })).status).toBe(201);
    const resumed = (await subscribe(app, "?channel=dev", undefined, "2")).body!.getReader();
    try {
      expect(decoder.decode((await resumed.read()).value)).toBe(": connected\n\n");
      const page = decoder.decode((await resumed.read()).value);
      expect(page).toStartWith("id: 3\nevent: board\n");
      expect(JSON.parse(page.split("\n")[2]!.slice("data: ".length))).toMatchObject({
        message: { text: "while away" },
      });
    } finally {
      await resumed.cancel();
    }
  } finally {
    await app.close();
  }
});

test("misses nothing when a post races the deadline", async () => {
  const timers = manualTimers();
  const app = makeApp({ schedule: timers.schedule });
  const decoder = new TextDecoder();
  const ids = (text: string) => Array.from(text.matchAll(/^id: (.+)$/gm), ([, id]) => id!);
  try {
    const reader = (await subscribe(app)).body!.getReader();
    let before = decoder.decode((await reader.read()).value) + decoder.decode((await reader.read()).value);
    // A read is in flight when the post wakes it and the deadline fires: its page is either sent or dropped unsent.
    const inFlight = reader.read();
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "racing the deadline" })).status).toBe(201);
    timers.fire(STREAM_MAX_MS);
    const raced = await inFlight;
    if (!raced.done) before += decoder.decode(raced.value);
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
      before += decoder.decode(chunk.value);
    const last = ids(before).at(-1)!;
    const resumed = (await subscribe(app, "?channel=dev", undefined, last)).body!.getReader();
    try {
      await resumed.read();
      const after = decoder.decode((await resumed.read()).value);
      const delivered = [...before.matchAll(/^event: board$/gm), ...after.matchAll(/^event: board$/gm)];
      expect(delivered).toHaveLength(1);
      expect(`${before}${after}`).toContain("id: 2\nevent: board\n");
    } finally {
      await resumed.cancel();
    }
  } finally {
    await app.close();
  }
});
