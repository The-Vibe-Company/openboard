import { expect, test } from "bun:test";
import type { CreatedConnection } from "@openboard/contract";
import type { BoardView, CommittedEvents, Store } from "@openboard/ports";
import { reauthorizeTogether } from "../../src/http/board.ts";
import { tailBoard } from "../../src/live/fan-out.ts";
import { BOARD_URL, call, makeApp, NOW, OWNER } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

/** `store`, counting the feed reads every board view sends to storage in `counted`. */
function counting(store: Store, counted: { reads: number }, headOnly = false): Store {
  return {
    ...store,
    board(scope) {
      const board = store.board(scope);
      return new Proxy(board, {
        get(target, key) {
          if (headOnly && key === "subscribeEvents") {
            return (...[after, wake, invalidate]: Parameters<BoardView["subscribeEvents"]>) =>
              target.subscribeEvents(after, (_page, head) => wake(undefined, head), invalidate);
          }
          if (key !== "readEvents") return Reflect.get(target, key);
          return (...args: Parameters<BoardView["readEvents"]>) => {
            counted.reads++;
            return target.readEvents(...args);
          };
        },
      });
    },
  };
}

/** Use one app and its real store so the in-memory path is exercised on both drivers. */
function countingStore() {
  const counted = { reads: 0 };
  const { sibling: _sibling, ...store } = openStore(() => NOW);
  return { store: counting(store, counted), counted };
}

type Stream = Awaited<ReturnType<typeof openStream>>;

/** A stream's frames as the client reads them, one enqueued page per read. */
async function openStream(app: ReturnType<typeof makeApp>, query: string, token = OWNER.token) {
  const response = await app.fetch(
    new Request(`${BOARD_URL}/events${query}`, {
      headers: { accept: "text/event-stream", authorization: `Bearer ${token}` },
    }),
  );
  expect(response.status).toBe(200);
  if (response.body == null) throw new Error("Expected a stream response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const next = async () => decoder.decode((await reader.read()).value);
  expect(await next()).toBe(": connected\n\n");
  await next(); // The first page: the cursor the stream starts from.
  return { next, close: () => reader.cancel() };
}

/** The `id:` lines of one page, each tagged with whether it carries an event or only a cursor. */
function ids(page: string): string[] {
  return Array.from(page.matchAll(/^id: (\d+)\n(event: board)?/gm), ([, id, event]) => {
    if (id == null) throw new Error("Expected an SSE cursor");
    return event ? id : `cursor ${id}`;
  });
}

const post = async (app: ReturnType<typeof makeApp>, channel: string, text: string) => {
  const response = await call(app, "POST", "/messages", { channel, text });
  expect(response.status).toBe(201);
  return ((await response.json()) as { message: { id: string } }).message.id;
};

function streamingApp(store: Store) {
  return makeApp({ store, schedule: () => () => {} });
}

test("a commit reaches every caught-up tail, from memory without a store read on its instance", async () => {
  const { store, counted } = countingStore();
  const app = streamingApp(store);
  const streams: Stream[] = [];
  try {
    for (let i = 0; i < 3; i++) streams.push(await openStream(app, "?after=0"));
    counted.reads = 0;
    const id = await post(app, "dev", "hello");
    for (const stream of streams) expect(ids(await stream.next())).toEqual([id]);
    expect(counted.reads).toBe(0);
  } finally {
    await Promise.all(streams.map((stream) => stream.close()));
    await app.close();
  }
}, 1000);

test("20 caught-up tails share one forward read on a head-only wake and filter independently", async () => {
  const { sibling, ...base } = openStore(() => NOW);
  const counted = { reads: 0 };
  const reader = streamingApp(counting(base, counted, !sibling));
  const writer = sibling ? streamingApp(sibling()) : reader;
  const streams: Stream[] = [];
  try {
    const queries = ["", "&channel=ops", "&channel=dev", "&from=other"];
    for (let i = 0; i < 20; i++) streams.push(await openStream(reader, `?after=0${queries[i % queries.length]}`));
    for (const body of ["first", "second"]) {
      counted.reads = 0;
      const id = await post(writer, "dev", body);
      const pages = await Promise.all(streams.map((stream) => stream.next()));
      for (const [i, page] of pages.entries()) {
        expect(ids(page)).toEqual([i % 2 === 0 ? id : `cursor ${id}`]);
      }
      expect(counted.reads).toBe(1);
    }
  } finally {
    await Promise.all(streams.map((stream) => stream.close()));
    if (writer !== reader) await writer.close();
    await reader.close();
  }
}, 1000);

test("hosted tails share pending authorization only for the same proof and recheck after revocation", async () => {
  const { sibling, ...base } = openStore(() => NOW);
  const writer = streamingApp(base);
  const remote = sibling?.() ?? base;
  let boardLookups = 0;
  const reader = makeApp({
    mode: "hosted",
    schedule: () => () => {},
    store: {
      ...remote,
      platform: () => {
        const platform = remote.platform();
        return new Proxy(platform, {
          get(target, key) {
            if (key !== "findBoard") return Reflect.get(target, key);
            return (...args: Parameters<typeof platform.findBoard>) => {
              boardLookups++;
              return platform.findBoard(...args);
            };
          },
        });
      },
    },
  });
  const create = async (name: string) => {
    const response = await call(writer, "POST", "/x/connections", { name, direct: true, can: { "*": "all" } });
    expect(response.status).toBe(201);
    return (await response.json()) as CreatedConnection;
  };
  const revokedStreams: Stream[] = [];
  let activeStream: Stream | undefined;
  try {
    const revoked = await create("revoked-reader");
    const active = await create("active-reader");
    for (let i = 0; i < 3; i++) revokedStreams.push(await openStream(reader, "?after=0", revoked.secret));
    activeStream = await openStream(reader, "?after=0", active.secret);
    boardLookups = 0;
    const first = await post(writer, "dev", "before revocation");
    for (const stream of [...revokedStreams, activeStream]) expect(ids(await stream.next())).toEqual([first]);
    expect(boardLookups).toBe(2);

    const result = await call(writer, "POST", `/x/connections/${revoked.connection.id}/revoke`);
    expect(result.status).toBe(200);
    const second = await post(writer, "dev", "after revocation");
    const next = ids(await activeStream.next());
    expect(next.includes(second) ? next : ids(await activeStream.next())).toContain(second);
    for (const stream of revokedStreams) {
      expect(await stream.next().catch((error: unknown) => error)).toMatchObject({ code: "unauthorized" });
    }
  } finally {
    await Promise.allSettled([...revokedStreams.map((stream) => stream.close()), activeStream?.close()]);
    await reader.close();
    await writer.close();
  }
}, 1000);

test("authorization already checking an earlier page cannot admit a later tail", async () => {
  const pending = new Map<string, ReturnType<typeof reauthorizeTogether>>();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const principal = { actor: "reader", principal: "reader", profile: null };
  const first = reauthorizeTogether(pending, "proof", async () => {
    started.resolve();
    await release.promise;
    return principal;
  });
  const denied = async () => {
    throw new Error("revoked");
  };
  expect(reauthorizeTogether(pending, "proof", denied)).toBe(first);
  await started.promise;
  try {
    await expect(reauthorizeTogether(pending, "proof", denied)).rejects.toThrow("revoked");
  } finally {
    release.resolve();
  }
  expect(await first).toBe(principal);
});

test("a slow tail never delays the others: it keeps one queued page, then catches up from the store", async () => {
  const { store, counted } = countingStore();
  const app = streamingApp(store);
  const fast = await openStream(app, "?after=0");
  const slow = await openStream(app, "?after=0");
  try {
    // The slow client reads nothing while four posts commit; the fast one reads each at once.
    const pending = slow.next();
    counted.reads = 0;
    const posted: string[] = [];
    for (const text of ["one", "two", "three", "four"]) {
      const cursor = await post(app, "dev", text);
      posted.push(cursor);
      expect(ids(await fast.next())).toEqual([cursor]);
    }
    const reads = counted.reads;
    const pages = [ids(await pending)];
    while (pages.flat().length < posted.length) pages.push(ids(await slow.next()));
    expect(pages.flat()).toEqual(posted);
    expect(reads).toBe(0);
    // The first post filled the waiting read and the second the stream's one queued frame. The tail queued the third
    // page; the fourth found that queue full, so both were dropped and the slow tail reads them from the store.
    const [first, second] = posted;
    if (first == null || second == null) throw new Error("Expected at least two posted cursors");
    expect(pages).toEqual([[first], [second], posted.slice(2)]);
    expect(counted.reads).toBe(1);
  } finally {
    await Promise.all([fast.close(), slow.close()]);
    await app.close();
  }
}, 1000);

test("a filtered tail and a channel-limited caller still receive only what they match and may read", async () => {
  const { store, counted } = countingStore();
  const app = streamingApp(store);
  const created = await call(app, "POST", "/x/connections", {
    name: "feed-reader",
    direct: true,
    can: { dev: ["read"] },
  });
  expect(created.status).toBe(201);
  const { secret } = (await created.json()) as CreatedConnection;
  const filtered = await openStream(app, "?channel=ops");
  // `dev` matches `dev/secret` too, but this caller may read only `dev` itself.
  const limited = await openStream(app, "?channel=dev", secret);
  try {
    counted.reads = 0;
    const hidden = await post(app, "dev/secret", "not for the reader");
    expect(ids(await filtered.next())).toEqual([`cursor ${hidden}`]);
    expect(ids(await limited.next())).toEqual([`cursor ${hidden}`]);
    const dev = await post(app, "dev", "for the reader");
    expect(ids(await filtered.next())).toEqual([`cursor ${dev}`]);
    expect(ids(await limited.next())).toEqual([dev]);
    const ops = await post(app, "ops", "for the filter");
    expect(ids(await filtered.next())).toEqual([ops]);
    expect(ids(await limited.next())).toEqual([`cursor ${ops}`]);
    expect(counted.reads).toBe(0);
  } finally {
    await Promise.all([filtered.close(), limited.close()]);
    await app.close();
  }
}, 1000);

test("a tail sends a page from the store when it is behind, the queue overflows, or a wake carries no page", () => {
  let wake: Parameters<BoardView["subscribeEvents"]>[1] = () => {};
  let subscribed = 0;
  const board = {
    subscribeEvents(_from: number, onWake: typeof wake) {
      wake = onWake;
      subscribed++;
      return () => subscribed--;
    },
  } as unknown as BoardView;
  const page = (after: number, head: number): CommittedEvents => ({ after, head, read: () => undefined });
  const tail = tailBoard(board, 0);
  expect(tail.take(0)).toBe("store");
  tail.settle({ cursor: 2, head: 2 });
  expect(tail.take(2)).toBe("wait");
  const third = page(2, 3);
  wake(third, 3);
  expect(tail.take(2)).toEqual({ committed: third });
  wake(page(3, 4), 4);
  wake(page(4, 5), 5);
  expect(tail.take(3)).toBe("store");
  tail.settle({ cursor: 5, head: 5 });
  wake(undefined, 6);
  expect(tail.take(5)).toBe("store");
  tail.settle({ cursor: 6, head: 6 });
  wake(page(4, 5), 5);
  expect(tail.take(6)).toBe("wait");
  wake(page(7, 8), 8);
  expect(tail.take(6)).toBe("store");
  tail.close();
  expect(subscribed).toBe(0);
});

test("a late head-only wake skips the store once the cursor covers its head", () => {
  let wake: Parameters<BoardView["subscribeEvents"]>[1] = () => {};
  const board = {
    subscribeEvents(_from: number, onWake: typeof wake) {
      wake = onWake;
      return () => {};
    },
  } as unknown as BoardView;
  const tail = tailBoard(board, undefined);
  expect(tail.take(undefined)).toBe("store");
  wake(undefined, 2);
  tail.settle({ cursor: 3, head: 3 });

  expect(tail.take(3)).toBe("wait");
  wake(undefined, 3);
  const page: CommittedEvents = { after: 3, head: 4, read: () => undefined };
  wake(page, 4);
  expect(tail.take(3)).toEqual({ committed: page });

  wake(undefined, 6);
  wake(undefined, 4);
  expect(tail.take(4)).toBe("store");
  tail.close();
});

test("a tail retries a shared snapshot taken before the head it was woken for", () => {
  let wake: Parameters<BoardView["subscribeEvents"]>[1] = () => {};
  const board = {
    subscribeEvents(_from: number, onWake: typeof wake) {
      wake = onWake;
      return () => {};
    },
  } as unknown as BoardView;
  const tail = tailBoard(board, 1);
  tail.take(1);
  tail.settle({ cursor: 1, head: 1 });
  wake(undefined, 3);

  expect(tail.take(1)).toBe("store");
  tail.settle({ cursor: 2, head: 2 });
  expect(tail.take(2)).toBe("store");
  tail.settle({ cursor: 3, head: 3 });
  expect(tail.take(3)).toBe("wait");
  tail.close();
});

test("a page served from memory carries the same events a store read returns", async () => {
  const { store, counted } = countingStore();
  const app = streamingApp(store);
  const queries = ["", "&all=true", "&channel=dev", "&from=board"];
  const streams: Stream[] = [];
  try {
    for (const query of queries) streams.push(await openStream(app, `?after=0${query}`));
    counted.reads = 0;
    const id = await post(app, "dev", "first");
    const writes = [
      () => call(app, "POST", `/messages/${id}/edit`, { text: "edited" }),
      () => call(app, "POST", `/messages/${id}/labels`, { set: { status: "open" } }),
      () => call(app, "POST", "/messages", { channel: "ops", text: "elsewhere" }),
      () => call(app, "POST", `/messages/${id}/delete`, {}),
    ];
    const streamed: unknown[][] = queries.map(() => []);
    const collect = async () => {
      for (const [i, stream] of streams.entries()) {
        const page = await stream.next();
        const events = streamed[i];
        if (events == null) throw new Error("Expected an event buffer for the stream");
        for (const [, data] of page.matchAll(/^data: (.+)$/gm)) {
          if (data == null) throw new Error("Expected event data");
          events.push(JSON.parse(data));
        }
      }
    };
    await collect();
    for (const write of writes) {
      expect((await write()).status).toBeLessThan(300);
      await collect();
    }
    expect(counted.reads).toBe(0);
    for (const [i, query] of queries.entries()) {
      const stored = (await (await call(app, "GET", `/events?after=0${query}`)).json()) as { events: unknown[] };
      expect(streamed[i]).toEqual(stored.events);
    }
    const [unfiltered] = streamed;
    if (unfiltered == null) throw new Error("Expected an unfiltered event buffer");
    expect(unfiltered.map((event) => (event as { type: string }).type)).toEqual([
      "message.posted",
      "message.edited",
      "labels.changed",
      "message.posted",
      "message.deleted",
    ]);
  } finally {
    await Promise.all(streams.map((stream) => stream.close()));
    await app.close();
  }
}, 1000);
