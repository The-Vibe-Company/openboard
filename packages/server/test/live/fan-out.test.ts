import { expect, test } from "bun:test";
import type { CreatedConnection } from "@openboard/contract";
import type { BoardView, CommittedEvents, Store } from "@openboard/ports";
import { tailBoard } from "../../src/live/fan-out.ts";
import { BOARD_URL, call, makeApp, NOW, OWNER } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

/** A test store that counts the feed reads every board view sends to storage. */
function countingStore() {
  const store = openStore(() => NOW);
  const counted = { reads: 0 };
  const wrapped: Store = {
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
  return { store: wrapped, counted };
}

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
  return { next, close: () => reader.cancel() };
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

function streamingApp(store: Store) {
  return makeApp({ store, schedule: () => () => {} });
}

test("a commit reaches every caught-up tail from memory, without a store read", async () => {
  const { store, counted } = countingStore();
  const app = streamingApp(store);
  const streams = [];
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
      posted.push(await post(app, "dev", text));
      expect(ids(await fast.next())).toEqual([posted.at(-1)!]);
    }
    expect(counted.reads).toBe(0);
    // The first post filled the waiting read and the second the stream's one queued frame. The tail queued the third
    // page; the fourth found that queue full, so both were dropped and the slow tail reads them from the store.
    expect(ids(await pending)).toEqual([posted[0]!]);
    expect(ids(await slow.next())).toEqual([posted[1]!]);
    expect(ids(await slow.next())).toEqual(posted.slice(2));
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
  let wake: (committed?: CommittedEvents) => void = () => {};
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
  wake(third);
  expect(tail.take(2)).toEqual({ committed: third });
  wake(page(3, 4));
  wake(page(4, 5));
  expect(tail.take(3)).toBe("store");
  tail.settle({ cursor: 5, head: 5 });
  wake();
  expect(tail.take(5)).toBe("store");
  tail.settle({ cursor: 6, head: 6 });
  wake(page(4, 5));
  expect(tail.take(6)).toBe("wait");
  wake(page(7, 8));
  expect(tail.take(6)).toBe("store");
  tail.close();
  expect(subscribed).toBe(0);
});
