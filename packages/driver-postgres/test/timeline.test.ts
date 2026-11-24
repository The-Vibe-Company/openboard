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

async function mainBoard(store: Store): Promise<BoardView> {
  const keys = await store.platform().findBoard("local", "main");
  if (!keys) throw new Error("missing local/main fixture board");
  return store.board(testScope(keys));
}

const url = postgresTestUrl();
if (url) {
  let databases: Awaited<ReturnType<typeof createTestDatabases>>;
  let database: Awaited<ReturnType<typeof databases.create>> | undefined;
  let store: Store | undefined;
  let admin: SQL | undefined;

  beforeAll(async () => {
    databases = await createTestDatabases(url, () => at);
  });
  beforeEach(async () => {
    database = await databases.create();
    admin = new SQL(database.url);
    store = await postgresDriver({ url: database.url }, () => at);
  });
  afterEach(async () => {
    try {
      await store?.close();
      await admin?.close();
    } finally {
      await database?.drop();
      database = undefined;
    }
  });
  afterAll(() => databases?.close());

  async function stored(sql: SQL) {
    const [row] = await sql`SELECT head, timeline, (pg_control_checkpoint()).timeline_id AS server FROM boards
      WHERE slug = 'main'`;
    return { head: Number(row.head), timeline: Number(row.timeline), server: Number(row.server) };
  }

  /** What a failover that lost the board's last commits leaves: events after `head` gone, another timeline recorded. */
  async function failOver(sql: SQL, head: number) {
    await sql`DELETE FROM events WHERE board_id = (SELECT id FROM boards WHERE slug = 'main') AND id > ${head}`;
    await sql`DELETE FROM messages WHERE board_id = (SELECT id FROM boards WHERE slug = 'main') AND id > ${head}`;
    await sql`UPDATE boards SET head = ${head}, timeline = timeline + 1 WHERE slug = 'main'`;
  }

  test("a board's first write records the server timeline without advancing the head", async () => {
    if (!store || !admin) throw new Error("missing Postgres test store");
    expect((await stored(admin)).timeline).toBe(0);
    expect((await (await mainBoard(store)).write((writer) => appendPost(writer, "first"))).id).toBe("1");
    const after = await stored(admin);
    expect(after).toEqual({ head: 1, timeline: after.server, server: after.server });
  });

  test("after a timeline change the next write advances the head by 1,000,000 above a reader's cursor", async () => {
    if (!store || !admin) throw new Error("missing Postgres test store");
    const board = await mainBoard(store);
    for (const text of ["one", "two", "three"]) await board.write((writer) => appendPost(writer, text));
    const cursor = (await board.readEvents(0)).cursor;
    expect(cursor).toBe(3);

    await failOver(admin, 1);
    const before = await stored(admin);
    expect(before.head).toBe(1);
    expect(before.timeline).not.toBe(before.server);

    expect((await board.write((writer) => appendPost(writer, "after failover"))).id).toBe("1000002");
    expect(await stored(admin)).toEqual({ head: 1_000_002, timeline: before.server, server: before.server });
    const page = await board.readEvents(cursor);
    expect(page.events.map(({ id }) => id)).toEqual([1_000_002]);
    expect(page.cursor).toBe(1_000_002);

    expect((await board.write((writer) => appendPost(writer, "next"))).id).toBe("1000003");
    expect((await stored(admin)).head).toBe(1_000_003);
  });

  test("a write that rolls back after a timeline change leaves the head and timeline for the next write", async () => {
    if (!store || !admin) throw new Error("missing Postgres test store");
    const board = await mainBoard(store);
    await board.write((writer) => appendPost(writer, "one"));
    await failOver(admin, 0);
    const before = await stored(admin);
    const failure = new Error("roll back the write");
    await expect(
      board.write(async (writer) => {
        await appendPost(writer, "rolled back");
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await stored(admin)).toEqual(before);
    expect((await board.write((writer) => appendPost(writer, "replacement"))).id).toBe("1000001");
  });
}
