import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { messages } from "@openboard/core";
import type { BoardView, BoardWriter, Store } from "@openboard/ports";
import { createViews, localBroadcaster, postgresText } from "@openboard/driver-sql";
import { testScope } from "@openboard/ports/testkit";
import { SQL } from "bun";
import { postgresBlobs } from "../src/blobs.ts";
import { connection } from "../src/pool.ts";
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
    const [row] = await sql`SELECT head, timeline,
      ('x' || substr(pg_walfile_name(pg_current_wal_lsn()), 1, 8))::bit(32)::bigint AS server FROM boards
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

  test("a write counts and repairs an untouched sibling's legacy UTF-8 message bytes", async () => {
    if (!store || !admin) throw new Error("missing Postgres test store");
    const platform = store.platform();
    const keys = await platform.findBoard("local", "main");
    if (!keys) throw new Error("missing local/main fixture board");
    const [sibling] = await admin`INSERT INTO boards (org_id, slug, name, created_at)
      VALUES (${keys.orgId}, 'sibling', 'Sibling', ${at}) RETURNING id`;
    await store
      .board(testScope({ orgId: keys.orgId, boardId: Number(sibling.id) }))
      .write((writer) => appendPost(writer, "é€"));
    await admin`UPDATE boards SET stored_bytes = 0, stored_bytes_head = 0 WHERE id = ${sibling.id}`;
    expect(await platform.setOrgQuotas(keys.orgId, { storedBytes: 10 })).toBe(true);
    const board = store.board(testScope(keys));

    await expect(board.write((writer) => appendPost(writer, "xx"))).rejects.toMatchObject({
      code: "quota_exceeded",
      reason: "stored_bytes",
    });
    await board.write((writer) => appendPost(writer, "x"));
    const [repaired] = await admin`SELECT head, stored_bytes, stored_bytes_head FROM boards WHERE id = ${sibling.id}`;
    expect(Number(repaired.stored_bytes)).toBe(7);
    expect(Number(repaired.stored_bytes_head)).toBe(Number(repaired.head));
  });

  test("a message waiting behind an upload sees its byte charge even though the board head did not move", async () => {
    if (!store || !admin) throw new Error("missing Postgres test store");
    const platform = store.platform();
    const keys = await platform.findBoard("local", "main");
    if (!keys) throw new Error("missing local/main fixture board");
    expect(await platform.setOrgQuotas(keys.orgId, { storedBytes: 5 })).toBe(true);
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const scope = testScope(keys);
    const board = store.board(scope);
    const uploader = createViews(connection(admin), postgresText, localBroadcaster(), undefined, (tx) => {
      const blobs = postgresBlobs(tx);
      return {
        ...blobs,
        async put(...args) {
          await blobs.put(...args);
          held.resolve();
          await release.promise;
        },
      };
    }).board(scope);
    const uploading = uploader.uploadAttachment(
      { id: "att_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "quota.txt", type: "text/plain", size: 3 },
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      by.principal,
      new TextEncoder().encode("abc"),
      at,
    );
    try {
      await Promise.race([uploading, held.promise]);
      const posting = board.write((writer) => appendPost(writer, "a")).catch((error: unknown) => error);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [row] = await admin`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'SELECT boards.head, boards.timeline%'
        ) AS waiting`;
        waiting = Boolean(row.waiting);
      }
      release.resolve();
      expect(waiting).toBe(true);
      expect(await posting).toMatchObject({ code: "quota_exceeded", reason: "stored_bytes" });
    } finally {
      release.resolve();
      await uploading;
    }
  });
}
