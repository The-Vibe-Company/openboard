import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { messages } from "@openboard/core";
import type { BoardView, BoardWriter, Store } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { SQL } from "bun";
import { createTestDatabases, postgresDriver } from "../src/index.ts";
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
    return { board: store.board(testScope(keys)), boardId: keys.boardId };
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
