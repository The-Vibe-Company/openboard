import { SQL } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { messages } from "@openboard/core";
import type { BoardView, BoardWriter, Store } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { createTestDatabases, postgresDriver } from "../src/index.ts";
import { postgresTestUrl } from "./support/env.ts";

const at = 1_700_000_000_000;
const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };

async function appendPost(writer: BoardWriter, text: string) {
  const { events, message } = messages.decidePost({ head: writer.head }, { channel: "dev", text }, { by, now: at });
  await writer.append(events);
  return message;
}

async function board(store: Store, slug = "main"): Promise<BoardView> {
  const keys = await store.platform().findBoard("local", slug);
  if (!keys) throw new Error(`missing local/${slug} fixture board`);
  return store.board(testScope(keys));
}

async function addBoard(url: string) {
  const sql = new SQL(url);
  try {
    await sql`
      INSERT INTO boards (org_id, slug, name, created_at)
      SELECT org_id, 'ops', 'Ops', ${at} FROM boards WHERE slug = 'main'
    `;
  } finally {
    await sql.close();
  }
}

async function follow(reader: BoardView, writing: () => boolean) {
  const positions: number[] = [];
  let cursor = 0;
  for (;;) {
    // Take one final snapshot after every writer has settled, even if a poll was already in flight.
    const final = !writing();
    const page = await reader.readEvents(cursor);
    for (const event of page.events) {
      expect(event.type).toBe("message.posted");
      expect(event.id).toBe(++cursor);
      positions.push(event.id);
    }
    expect(page.cursor).toBe(cursor);
    if (final) return positions;
  }
}

const url = postgresTestUrl();
if (url) {
  let databases: Awaited<ReturnType<typeof createTestDatabases>>;
  let database: Awaited<ReturnType<typeof databases.create>> | undefined;
  const stores: Store[] = [];
  let releaseHeldWrite: (() => void) | undefined;
  let overlappingWrites: Promise<unknown> | undefined;

  beforeAll(async () => {
    databases = await createTestDatabases(url, () => at);
  });
  beforeEach(async () => {
    database = await databases.create();
  });
  afterEach(async () => {
    releaseHeldWrite?.();
    await overlappingWrites;
    releaseHeldWrite = undefined;
    overlappingWrites = undefined;
    try {
      await Promise.all(stores.splice(0).map((store) => store.close()));
    } finally {
      await database?.drop();
      database = undefined;
    }
  });
  afterAll(() => databases?.close());

  async function openStore() {
    if (!database) throw new Error("missing Postgres test database");
    const store = await postgresDriver({ url: database.url }, () => at);
    stores.push(store);
    return store;
  }

  test("three Postgres pools post 60 messages while a cursor reader sees each position in order", async () => {
    const writers = [await board(await openStore()), await board(await openStore()), await board(await openStore())];
    const reader = writers[2]!;
    const texts = Array.from({ length: 60 }, (_, i) => `post ${i + 1}`);
    const expected = texts.map((_, i) => i + 1);
    let writing = true;
    const reading = follow(reader, () => writing);
    const writingPosts = Promise.allSettled(
      texts.map((text, i) => writers[i % writers.length]!.write((writer) => appendPost(writer, text))),
    ).finally(() => {
      writing = false;
    });

    const [read, writes] = await Promise.allSettled([reading, writingPosts] as const);
    if (writes.status === "rejected") throw writes.reason;
    for (const write of writes.value) {
      if (write.status === "rejected") throw write.reason;
    }
    if (read.status === "rejected") throw read.reason;
    expect(read.value).toEqual(expected);
    const snapshot = await reader.readEvents(0);
    expect(snapshot.head).toBe(60);
    expect(snapshot.events.map(({ id }) => id)).toEqual(expected);
    expect(
      snapshot.events
        .filter((event) => event.type === "message.posted")
        .map(({ payload }) => payload.text)
        .sort(),
    ).toEqual(texts.toSorted());
  });

  test("a second board commits while a first board's write is held open on another pool", async () => {
    if (!database) throw new Error("missing Postgres test database");
    await addBoard(database.url);
    const main = await board(await openStore());
    const ops = await board(await openStore(), "ops");
    const appended = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    releaseHeldWrite = release.resolve;
    const first = main.write(async (writer) => {
      await appendPost(writer, "held");
      appended.resolve();
      await release.promise;
    });
    const second = Promise.race([appended.promise, first]).then(() =>
      ops.write((writer) => appendPost(writer, "independent")),
    );
    overlappingWrites = Promise.allSettled([first, second]);

    try {
      expect((await second).id).toBe("1");
      expect(await main.readEvents(0)).toEqual({ head: 0, cursor: 0, events: [] });
    } finally {
      release.resolve();
      await first;
    }
    expect((await main.readEvents(0)).head).toBe(1);
  }, 1_000);

  test("a rolled-back append leaves the board head and events unchanged on another pool", async () => {
    const writer = await board(await openStore());
    const reader = await board(await openStore());
    await writer.write((tx) => appendPost(tx, "committed"));
    const before = await reader.readEvents(0);
    expect(before.head).toBe(1);
    const failure = new Error("roll back the append");
    await expect(
      writer.write(async (tx) => {
        await appendPost(tx, "rolled back");
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await reader.readEvents(0)).toEqual(before);
    expect((await reader.write((tx) => appendPost(tx, "replacement"))).id).toBe("2");
  });
}
