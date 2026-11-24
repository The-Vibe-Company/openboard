import { expect, test } from "bun:test";
import type { CreatedConnection } from "@openboard/contract";
import type { BoardView, CommittedEvents, Store } from "@openboard/ports";
import { tailBoard } from "../../src/live/fan-out.ts";
import { BOARD_URL, call, makeApp, NOW, OWNER } from "../support/app.ts";
import { openStore, type TestStore } from "../support/drivers.ts";

/** `store`, counting the feed reads every board view sends to storage in `counted`. */
function counting(store: Store, counted: { reads: number }): Store {
  return {
    ...store,
    board(scope) {
      const board = store.board(scope);
      return new Proxy(board, {
        get(target, key) {
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

/** A test store that counts the feed reads of every instance on it, the second instance's included. */
function countingStore() {
  const store = openStore(() => NOW);
  const counted = { reads: 0 };
  const { sibling } = store;
  const wrapped: TestStore = {
    ...counting(store, counted),
    ...(sibling && { sibling: () => counting(sibling(), counted) }),
  };
  return { store: wrapped, counted };
}

/**
 * The store reads a write costs its caught-up tails: none on the instance that wrote, which holds the committed page in
 * memory, and one for each tail on another instance, which a notification wakes with only the new head (D36).
 */
function remoteReads(tails: readonly { readonly instance: number }[], writer: number) {
  return tails.filter((tail) => tail.instance !== writer).length;
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
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const next = async () => decoder.decode((await reader.read()).value);
  expect(await next()).toBe(": connected\n\n");
  await next(); // The first page: the cursor the stream starts from.
  return { next, close: () => reader.cancel(), instance: app.served.at(-1)! };
}

/** The `id:` lines of one page, each tagged with whether it carries an event or only a cursor. */
function ids(page: string): string[] {
  return Array.from(page.matchAll(/^id: (\d+)\n(event: board)?/gm), ([, id, event]) => (event ? id! : `cursor ${id}`));
}

const post = async (app: ReturnType<typeof makeApp>, channel: string, text: string) => {
  const response = await call(app, "POST", "/messages", { channel, text });
  expect(response.status).toBe(201);
  return ((await response.json()) as { message: { id: string } }).message.id;
};

function streamingApp(store: TestStore) {
  return makeApp({ store, schedule: () => () => {} });
}

test("a commit reaches every caught-up tail on its instance from memory, and with one read on another", async () => {
  const { store, counted } = countingStore();
  const app = streamingApp(store);
  const streams: Stream[] = [];
  try {
    for (let i = 0; i < 3; i++) streams.push(await openStream(app, "?after=0"));
    counted.reads = 0;
    const id = await post(app, "dev", "hello");
    for (const stream of streams) expect(ids(await stream.next())).toEqual([id]);
    expect(counted.reads).toBe(remoteReads(streams, app.served.at(-1)!));
  } finally {
    await Promise.all(streams.map((stream) => stream.close()));
    await app.close();
  }
}, 1000);

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
    const writers: number[] = [];
    for (const text of ["one", "two", "three", "four"]) {
      posted.push(await post(app, "dev", text));
      writers.push(app.served.at(-1)!);
      expect(ids(await fast.next())).toEqual([posted.at(-1)!]);
    }
    const reads = counted.reads;
    const pages = [ids(await pending)];
    while (pages.flat().length < posted.length) pages.push(ids(await slow.next()));
    expect(pages.flat()).toEqual(posted);
    // A write on another instance wakes the slow tail without a page, so only one instance fixes how its pages split.
    if (writers.every((writer) => writer === fast.instance && writer === slow.instance)) {
      expect(reads).toBe(0);
      // The first post filled the waiting read and the second the stream's one queued frame. The tail queued the third
      // page; the fourth found that queue full, so both were dropped and the slow tail reads them from the store.
      expect(pages).toEqual([[posted[0]!], [posted[1]!], posted.slice(2)]);
      expect(counted.reads).toBe(1);
    }
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
    let expected = 0;
    const write = async (channel: string, text: string) => {
      const id = await post(app, channel, text);
      expected += remoteReads([filtered, limited], app.served.at(-1)!);
      return id;
    };
    const hidden = await write("dev/secret", "not for the reader");
    expect(ids(await filtered.next())).toEqual([`cursor ${hidden}`]);
    expect(ids(await limited.next())).toEqual([`cursor ${hidden}`]);
    const dev = await write("dev", "for the reader");
    expect(ids(await filtered.next())).toEqual([`cursor ${dev}`]);
    expect(ids(await limited.next())).toEqual([dev]);
    const ops = await write("ops", "for the filter");
    expect(ids(await filtered.next())).toEqual([ops]);
    expect(ids(await limited.next())).toEqual([`cursor ${ops}`]);
    expect(counted.reads).toBe(expected);
  } finally {
    await Promise.all([filtered.close(), limited.close()]);
    await app.close();
  }
}, 1000);

test("a tail sends a page from the store when it is behind, the queue overflows, or a wake carries no page", () => {
  let wake: (committed: CommittedEvents | undefined, head: number) => void = () => {};
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

test("a wake without a page for a head the tail has already read costs no store read", () => {
  let wake: (committed: CommittedEvents | undefined, head: number) => void = () => {};
  const board = {
    subscribeEvents(_from: number, onWake: typeof wake) {
      wake = onWake;
      return () => {};
    },
  } as unknown as BoardView;
  const tail = tailBoard(board, undefined);
  expect(tail.take(undefined)).toBe("store");
  // Another instance's notifications for heads 2 and 3 arrive after, or during, the read that reached 3.
  wake(undefined, 2);
  tail.settle({ cursor: 3, head: 3 });
  wake(undefined, 3);
  expect(tail.take(3)).toBe("wait");
  // Its own next commit is then served from memory; a later head announced without its page is read from the store.
  const fourth: CommittedEvents = { after: 3, head: 4, read: () => undefined };
  wake(fourth, 4);
  expect(tail.take(3)).toEqual({ committed: fourth });
  wake(undefined, 5);
  expect(tail.take(4)).toBe("store");
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
    let expected = remoteReads(streams, app.served.at(-1)!);
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
        streamed[i]!.push(...Array.from(page.matchAll(/^data: (.+)$/gm), ([, data]) => JSON.parse(data!)));
      }
    };
    await collect();
    for (const write of writes) {
      expect((await write()).status).toBeLessThan(300);
      expected += remoteReads(streams, app.served.at(-1)!);
      await collect();
    }
    expect(counted.reads).toBe(expected);
    for (const [i, query] of queries.entries()) {
      const stored = (await (await call(app, "GET", `/events?after=0${query}`)).json()) as { events: unknown[] };
      expect(streamed[i]).toEqual(stored.events);
    }
    expect(streamed[0]!.map((event) => (event as { type: string }).type)).toEqual([
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
