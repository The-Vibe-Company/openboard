import { expect, test } from "bun:test";
import type { OutputOf, readEvents } from "@openboard/contract";
import type { BoardView, Store } from "@openboard/ports";
import type { App } from "../../src/index.ts";
import { BOARD_URL, call, makeApp, NOW, OWNER } from "../support/app.ts";
import { openStore, type TestStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";

const channel = "drill";

function post(app: App, key: string) {
  return call(app, "POST", "/messages", { channel, id: key, text: key });
}

async function acknowledged(response: Response): Promise<string> {
  expect(response.ok).toBe(true);
  return ((await response.json()) as { message: { id: string } }).message.id;
}

/** A terminated pool can answer unavailable while it replaces its connections. Retry the same id. */
async function recoveredPost(app: App, id: string, signal: AbortSignal): Promise<string> {
  let response = await post(app, id);
  while (response.status === 503) {
    expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
    if (signal.aborted) break;
    response = await post(app, id);
  }
  if (!response.ok) throw new Error(`Postgres recovery write ${id} returned HTTP ${response.status}`);
  return acknowledged(response);
}

async function openStream(app: App, signal: AbortSignal) {
  const response = await app.fetch(
    new Request(`${BOARD_URL}/events?channel=${channel}&after=0`, {
      headers: { accept: "text/event-stream", authorization: `Bearer ${OWNER.token}` },
      signal,
    }),
  );
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const next = async () => {
    const chunk = await reader.read();
    expect(chunk.done).toBe(false);
    return decoder.decode(chunk.value);
  };
  expect(await next()).toBe(": connected\n\n");
  expect(await next()).toBe("id: 0\n\n");
  return { next, close: () => reader.cancel() };
}

async function readPosts(stream: Awaited<ReturnType<typeof openStream>>, count: number): Promise<string[]> {
  const ids: string[] = [];
  while (ids.length < count) {
    const frame = await stream.next();
    for (const [, data] of frame.matchAll(/^data: (.+)$/gm)) {
      const event = JSON.parse(data!) as OutputOf<typeof readEvents>["events"][number];
      if (event.type === "message.posted") ids.push(event.cursor);
    }
  }
  return ids;
}

function longPoll(app: App, after: string, signal: AbortSignal) {
  return app.fetch(
    new Request(`${BOARD_URL}/events?channel=${channel}&after=${after}&wait=30`, {
      headers: { authorization: `Bearer ${OWNER.token}` },
      signal,
    }),
  );
}

async function pollPosts(poll: Promise<Response>): Promise<string[]> {
  const response = await poll;
  expect(response.status).toBe(200);
  const body = (await response.json()) as OutputOf<typeof readEvents>;
  return body.events.map(({ cursor }) => cursor);
}

async function interruptedPost(app: App, key: string) {
  const start = performance.now();
  const response = await post(app, key);
  const milliseconds = performance.now() - start;
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
  expect(milliseconds).toBeLessThan(3_000);
}

/** Observe the real long-poll's initial read on B without replacing the query or its result. */
function observePoll(store: TestStore, finish: (cursor: number) => void): TestStore {
  const sibling = store.sibling;
  if (!sibling) throw new Error("The drill needs a sibling store");
  const instrument = (target: Store): Store => ({
    ...target,
    board(scope) {
      const view = target.board(scope);
      return new Proxy(view, {
        get(target, key) {
          if (key !== "readEvents") return Reflect.get(target, key);
          return async (...args: Parameters<BoardView["readEvents"]>) => {
            const page = await target.readEvents(...args);
            // This fixture uses the local-owner verifier, so reauthorization only runs microtasks.
            if (page.events.length === 0 && page.head === args[0]) setImmediate(finish, page.head);
            return page;
          };
        },
      });
    },
  });
  return { ...store, sibling: () => instrument(sibling()) };
}

async function interruptPosts(interruptWrites: NonNullable<TestStore["interruptWrites"]>, a: App, b: App) {
  let interrupted: Promise<PromiseSettledResult<void>[]> | undefined;
  expect(
    await interruptWrites(2, () => {
      interrupted = Promise.allSettled([interruptedPost(a, "retry-a"), interruptedPost(b, "retry-b")]);
    }),
  ).toBeGreaterThanOrEqual(4); // Two blocked pools and two dedicated listeners.
  expect(await interrupted).toEqual([
    { status: "fulfilled", value: undefined },
    { status: "fulfilled", value: undefined },
  ]);
}

if (postgresTestUrl()) {
  test("acknowledged posts and live tails survive the database connection drill", async () => {
    const store = openStore(() => NOW);
    if (!store.interruptWrites) throw new Error("The drill needs Postgres");
    let ping: (() => void) | undefined;
    const polling = Promise.withResolvers<void>();
    let pollCursor: number | undefined;
    const app = makeApp({
      store: observePoll(store, (cursor) => {
        if (cursor === pollCursor) polling.resolve();
      }),
      schedule(milliseconds, run) {
        if (milliseconds === 15_000) ping = run;
        // Neither the long-poll deadline nor the SSE deadline advances during this drill.
        return () => {};
      },
    });
    const [a, b] = app.instances;
    if (!a || !b) throw new Error("The drill needs two instances");
    const abort = new AbortController();
    let stream: Awaited<ReturnType<typeof openStream>> | undefined;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(900)]);

    try {
      stream = await openStream(b, signal);
      const before = [];
      for (const [instance, key] of [
        [a, "before-a"],
        [b, "before-b"],
      ] as const) {
        const id = await acknowledged(await post(instance, key));
        before.push(id);
        expect(await readPosts(stream, 1)).toEqual([id]);
      }

      const cursor = before.at(-1)!;
      pollCursor = Number(cursor);
      const waiting = longPoll(b, cursor, signal);
      await Promise.race([
        polling.promise,
        waiting.then((response) => {
          throw new Error(`Long poll answered ${response.status} before parking`);
        }),
      ]);
      await interruptPosts(store.interruptWrites, a, b);

      const next = stream.next();
      expect(ping).toBeDefined();
      ping?.();
      expect(await next).toBe(": ping\n\n");

      const recoveredA = await recoveredPost(a, "retry-a", signal);
      expect(await pollPosts(waiting)).toEqual([recoveredA]);
      expect(await readPosts(stream, 1)).toEqual([recoveredA]);

      const recoveredB = await recoveredPost(b, "retry-b", signal);
      expect(await readPosts(stream, 1)).toEqual([recoveredB]);
      expect(await acknowledged(await post(a, "retry-a"))).toBe(recoveredA);
      expect(await acknowledged(await post(b, "retry-b"))).toBe(recoveredB);

      // A later cross-instance notification also fences both replays on the same stream.
      const live = await acknowledged(await post(a, "after-a"));
      expect(await readPosts(stream, 1)).toEqual([live]);

      const fence = await acknowledged(await call(a, "POST", "/messages", { channel: "fence", text: "fence" }));
      expect(await stream.next()).toBe(`id: ${fence}\n\n`);

      const response = await call(a, "GET", `/messages?channel=${channel}&after=0`);
      expect(response.status).toBe(200);
      const { messages } = (await response.json()) as { messages: { id: string }[] };
      expect(messages.map(({ id }) => id)).toEqual([...before, recoveredA, recoveredB, live]);
    } finally {
      abort.abort();
      try {
        await stream?.close();
      } finally {
        await app.close();
      }
    }
  }, 990);
}
