import { expect, spyOn, test } from "bun:test";
import { messages } from "@openboard/core";
import { createViews, postgresText } from "@openboard/driver-sql";
import type { BoardWriter } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { SQL } from "bun";
import { postgresBroadcaster } from "../src/broadcaster.ts";
import { createTestDatabases, terminateTestConnections } from "../src/database.ts";
import { connection } from "../src/pool.ts";
import { postgresTestUrl } from "./support/env.ts";

async function append(tx: BoardWriter, text: string) {
  const actor = "ob:user:local-test";
  const { events } = messages.decidePost(
    { head: tx.head },
    { channel: "dev", text },
    { by: { actor, principal: actor, profile: null }, now: 0 },
  );
  await tx.append(events);
  return events.map(({ id }) => id);
}

async function writeBeforeReconnect(url: string, deadline: Promise<never>, write: () => Promise<number[]>) {
  const schedule = globalThis.setTimeout;
  const retries: (() => void)[] = [];
  const armed = Promise.withResolvers<void>();
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((
    run: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    // Bun's first LISTEN retry is 250 ms with ±25% jitter. Hold both listeners until the writes commit.
    if (typeof delay !== "number" || delay < 187.5 || delay > 312.5) return schedule(run, delay, ...args);
    const handle = schedule(run, 60_000, ...args).unref();
    retries.push(() => {
      clearTimeout(handle);
      run(...args);
    });
    if (retries.length === 2) armed.resolve();
    return handle;
  }) as typeof setTimeout);
  try {
    expect(await terminateTestConnections(url)).toBe(4);
    await Promise.race([armed.promise, deadline]);
    return await write();
  } finally {
    timer.mockRestore();
    for (const retry of retries) retry();
  }
}

async function checkReconnect(url: string, deadline: Promise<never>) {
  await using pool = new SQL(url, { max: 1 });
  const db = connection(pool);
  let safetyPoll: (() => Promise<void>) | undefined;
  const broadcaster = await postgresBroadcaster(pool, db, (tick) => {
    safetyPoll = tick;
    return () => {};
  });
  try {
    await using writer = new SQL(url, { max: 1 });
    const writerDb = connection(writer);
    const writerBroadcaster = await postgresBroadcaster(writer, writerDb);
    try {
      const store = createViews(writerDb, postgresText, writerBroadcaster);
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("missing local/main fixture");
      const scope = testScope(keys);
      const source = store.board(scope);
      await source.write((tx) => append(tx, "before"));
      const board = createViews(db, postgresText, broadcaster).board(scope);
      const { head } = await board.readEvents();
      const cursors: number[] = [];
      const positions: number[] = [];
      let cursor = head;
      let delivered = Promise.withResolvers<void>();
      const stop = board.subscribeEvents(head, () => {
        cursors.push(cursor);
        const wake = delivered;
        void board.readEvents(cursor, { all: true }).then(({ cursor: next, events }) => {
          cursor = next;
          positions.push(...events.map(({ id }) => id));
          wake.resolve();
        }, wake.reject);
      });
      try {
        const missed = await writeBeforeReconnect(url, deadline, async () => {
          const first = await source.write((tx) => append(tx, "while disconnected, first"));
          const second = await source.write((tx) => append(tx, "while disconnected, second"));
          expect(cursors).toEqual([]);
          return [...first, ...second];
        });
        await Promise.race([delivered.promise, deadline]);
        await safetyPoll?.();
        expect(cursors).toEqual([head]);
        expect(positions).toEqual(missed);

        const caughtUpCursor = cursor;
        delivered = Promise.withResolvers<void>();
        const live = await source.write((tx) => append(tx, "after re-subscribe"));
        await Promise.race([delivered.promise, deadline]);
        expect(cursors).toEqual([head, caughtUpCursor]);
        expect(positions).toEqual([...missed, ...live]);
      } finally {
        stop();
      }
    } finally {
      await writerBroadcaster.close();
    }
  } finally {
    await broadcaster.close();
  }
}

const url = postgresTestUrl();
if (url) {
  test("the existing tail reads missed posts once in order when LISTEN is restored", async () => {
    // Fail inside the test body first, so the connection and database cleanup can run.
    const deadline = Promise.withResolvers<never>();
    const watchdog = setTimeout(
      () => deadline.reject(new Error("The tail did not recover before the test deadline")),
      800,
    );
    void deadline.promise.catch(() => {});
    try {
      const databases = await createTestDatabases(url);
      try {
        const database = await databases.create();
        try {
          await checkReconnect(database.url, deadline.promise);
        } finally {
          await database.drop();
        }
      } finally {
        await databases.close();
      }
    } finally {
      clearTimeout(watchdog);
    }
  }, 990);
}
