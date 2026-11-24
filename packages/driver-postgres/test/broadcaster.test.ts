import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { messages } from "@openboard/core";
import type { BoardView, BoardWriter, CommittedPage, Store } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { SQL } from "bun";
import { postgresBroadcaster } from "../src/broadcaster.ts";
import { createTestDatabases, postgresDriver } from "../src/index.ts";
import { connection } from "../src/pool.ts";
import { postgresTestUrl } from "./support/env.ts";

const url = postgresTestUrl();
const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };

async function append(writer: BoardWriter) {
  const { events } = messages.decidePost({ head: writer.head }, { channel: "dev", text: "hello" }, { by, now: 0 });
  await writer.append(events);
  return events.map(({ id }) => id);
}

function tail(board: BoardView, from: number) {
  let cursor = from;
  const reads: number[] = [];
  const positions: number[] = [];
  let wake = Promise.withResolvers<void>();
  let reading = Promise.resolve();
  const stop = board.subscribeEvents(cursor, () => {
    reading = reading.then(async () => {
      reads.push(cursor);
      const result = await board.readEvents(cursor, { all: true });
      cursor = result.cursor;
      positions.push(...result.events.map(({ id }) => id));
      wake.resolve();
      wake = Promise.withResolvers<void>();
    });
    void reading.catch((error) => wake.reject(error));
  });
  return { reads, positions, stop, next: () => wake.promise };
}

if (url) {
  let databases: Awaited<ReturnType<typeof createTestDatabases>>;
  let database: Awaited<ReturnType<typeof databases.create>>;
  const stores: Store[] = [];

  beforeAll(async () => {
    databases = await createTestDatabases(url);
  });
  beforeEach(async () => {
    database = await databases.create();
  });
  afterEach(async () => {
    try {
      await Promise.all(stores.splice(0).map((store) => store.close()));
    } finally {
      await database.drop();
    }
  });
  afterAll(() => databases?.close());

  async function open() {
    const store = await postgresDriver({ url: database.url });
    stores.push(store);
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing local/main fixture");
    const scope = testScope(keys);
    return { board: store.board(scope), boardId: keys.boardId, scope };
  }

  test("a tail on one instance reads positions written on another in order, each once", async () => {
    const subscriber = await open();
    const writer = await open();
    const cursor = (await subscriber.board.readEvents()).head;
    const subscription = tail(subscriber.board, cursor);
    try {
      const firstRead = subscription.next();
      const first = await writer.board.write(append);
      await firstRead;
      const secondRead = subscription.next();
      const second = await writer.board.write(append);
      await secondRead;

      expect(subscription.positions).toEqual([...first, ...second]);
      expect(subscription.reads).toEqual([cursor, Math.max(...first)]);
    } finally {
      subscription.stop();
    }
  }, 850);

  test("notifications delivered together wake one read from the subscriber's cursor", async () => {
    const subscriber = await open();
    const writer = await open();
    await using sql = new SQL(database.url);
    const notifications: string[] = [];
    const receivedBoth = Promise.withResolvers<void>();
    await using _listener = await sql.listen("ob_events", (payload) => {
      notifications.push(payload);
      if (notifications.length === 2) receivedBoth.resolve();
    });
    const cursor = (await subscriber.board.readEvents()).head;
    const subscription = tail(subscriber.board, cursor);
    try {
      const read = subscription.next();
      const batches = await writer.board.write(async (tx) => [await append(tx), await append(tx)]);
      await Promise.all([read, receivedBoth.promise]);
      expect(notifications).toEqual(batches.map((batch) => `${writer.boardId}:${batch.at(-1)}`));
      expect(subscription.positions).toEqual(batches.flat());
      expect(subscription.reads).toEqual([cursor]);
    } finally {
      subscription.stop();
    }
  }, 850);

  test("the local page wins over early and late notifications, and a newer remote commit wakes again", async () => {
    const writer = await open();
    await using sql = new SQL(database.url);
    const after = (await writer.board.readEvents()).head;
    const page = { after, head: after + 1, events: [] };
    const payload = `${writer.boardId}:${page.head}`;
    let flushed = Promise.withResolvers<void>();
    // Observe each local notification on the broadcaster's connection after its queued wake has flushed.
    const broadcaster = await postgresBroadcaster(
      {
        listen: (channel, wake, onListen) =>
          sql.listen(
            channel,
            (message) => {
              wake(message);
              if (message === payload) setImmediate(() => setImmediate(flushed.resolve));
            },
            onListen,
          ),
      },
      connection(sql),
      () => () => {},
    );
    try {
      const wakes: { page: CommittedPage | undefined; head: number }[] = [];
      const remoteWake = Promise.withResolvers<void>();
      broadcaster.subscribe(writer.scope, after, (page, head) => {
        wakes.push({ page, head });
        if (page === undefined) remoteWake.resolve();
      });

      const release = broadcaster.prepareCommit?.(writer.scope, page);
      if (!release) throw new Error("missing local commit tracking");
      await sql.notify("ob_events", payload);
      await flushed.promise;
      expect(wakes).toStrictEqual([]);

      broadcaster.publish(writer.scope, page);
      release();
      flushed = Promise.withResolvers<void>();
      await sql.notify("ob_events", payload);
      await flushed.promise;
      expect(wakes).toStrictEqual([{ page, head: page.head }]);

      const remote = await writer.board.write(async (tx) => {
        await append(tx);
        return append(tx);
      });
      await remoteWake.promise;
      expect(wakes).toStrictEqual([
        { page, head: page.head },
        { page: undefined, head: Math.max(...remote) },
      ]);
    } finally {
      await broadcaster.close();
    }
  }, 850);

  test("the safety poll can wake a tail while a local commit acknowledgment is pending", async () => {
    const writer = await open();
    await using sql = new SQL(database.url);
    let poll: (() => Promise<void>) | undefined;
    const broadcaster = await postgresBroadcaster(sql, connection(sql), (tick) => {
      poll = tick;
      return () => {};
    });
    try {
      const after = (await writer.board.readEvents()).head;
      const wakes: (CommittedPage | undefined)[] = [];
      broadcaster.subscribe(writer.scope, after, (page) => wakes.push(page));
      const release = broadcaster.prepareCommit?.(writer.scope, { after, head: after + 1, events: [] });
      if (!release || !poll) throw new Error("missing commit tracking or safety poll");
      expect(await writer.board.write(append)).toEqual([after + 1]);

      await poll();
      expect(wakes).toStrictEqual([undefined]);
      release();
      expect(wakes).toStrictEqual([undefined]);
    } finally {
      await broadcaster.close();
    }
  }, 850);

  test("rolled-back and no-op writes send no notification", async () => {
    const writer = await open();
    await using sql = new SQL(database.url);
    const observed: string[] = [];
    const fence = Promise.withResolvers<void>();
    await using _listener = await sql.listen("ob_events", (payload) => {
      if (payload === "fence") fence.resolve();
      else observed.push(payload);
    });
    const { head } = await writer.board.readEvents();
    await writer.board.write((tx) => tx.append([]));
    await expect(
      writer.board.write(async (tx) => {
        await append(tx);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    // PostgreSQL delivers notifications in commit order. The fence lets us check absence without sleeping.
    await sql.notify("ob_events", "fence");
    await fence.promise;
    expect(observed).toEqual([]);
    expect((await writer.board.readEvents()).head).toBe(head);
  }, 850);
}
