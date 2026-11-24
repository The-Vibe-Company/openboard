import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { migrations } from "@openboard/driver-sql";
import { BACKFILL_BOARD_ORG_JOB } from "@openboard/ports";
import { testOrgScope, testScope } from "@openboard/ports/testkit";
import { sqliteDriver } from "../src/index.ts";

test("keeps a posted message and the migration records on reopen", async () => {
  const root = mkdtempSync("openboard-test-");
  const dir = join(root, "nested", "data");
  const scope = testScope({ orgId: 1, boardId: 1 });
  const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
  try {
    const first = sqliteDriver({ dir }, () => 100);
    try {
      await first.board(scope).write((writer) =>
        writer.append([
          {
            id: 1,
            type: "message.posted",
            at: 100,
            channel: "dev",
            thread: 1,
            message: 1,
            actor: by.actor,
            principal: by.principal,
            visibility: 0,
            payload: {
              channel: "dev",
              text: "hello",
              re: null,
              replyTo: null,
              thread: "1",
              labels: {},
              noSync: false,
              by,
              origin: null,
              from: null,
              attachments: [],
              links: [],
            },
          },
        ]),
      );
    } finally {
      await first.close();
    }

    const reopened = sqliteDriver({ dir }, () => 200);
    try {
      const messages = await reopened.board(scope).channelMessages({ channel: "dev", limit: 1 });
      expect(messages?.map(({ id, text }) => ({ id, text }))).toEqual([{ id: "1", text: "hello" }]);
    } finally {
      await reopened.close();
    }

    const database = new Database(join(dir, "board.db"), { readonly: true });
    try {
      expect(database.query("SELECT org_id, board_id, id, type FROM events").all()).toEqual([
        { org_id: 1, board_id: 1, id: 1, type: "message.posted" },
      ]);
      expect(database.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect(database.query("SELECT version, applied_at FROM schema_migrations ORDER BY version").all()).toEqual(
        migrations.map(({ version }) => ({ version, applied_at: 100 })),
      );
    } finally {
      database.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pins a legacy connection's original grant before an edit names it in an earlier grant", async () => {
  const dir = mkdtempSync("openboard-legacy-grant-");
  const scope = testScope({ orgId: 1, boardId: 1 });
  const connection = "cn_aaaaaaaaaaaaaaaa";
  const principals = [{ kind: "connection", connection }] as const;
  const actor = "ob:user:local-dev";
  const driver = sqliteDriver({ dir }, () => 100);
  try {
    // Schema 12's writer inserts the same rows while leaving the new, nullable origin column unset.
    const database = new Database(join(dir, "board.db"));
    try {
      database
        .query("INSERT INTO grants (org_id, board_id, id, principals, can, capped) VALUES (1, 1, 4, ?, ?, 0)")
        .run(JSON.stringify(principals), JSON.stringify({ ops: ["read"] }));
      database
        .query("INSERT INTO grant_principals (board_id, grant_id, kind, key, detail) VALUES (1, 4, 'connection', ?, ?)")
        .run(connection, JSON.stringify(principals[0]));
      database
        .query(`INSERT INTO connections
        (id, org_id, board_id, name, secret_hash, secret_hint, direct, profiles, token_ttl_s, token_max_s, created_by, created_at)
        VALUES (?, 1, 1, 'legacy', zeroblob(32), 'hint', 1, '["*"]', 3600, 86400, ?, 100)`)
        .run(connection, actor);
    } finally {
      database.close();
    }
    await driver.board(scope).write((writer) =>
      writer.append([
        {
          id: writer.head + 1,
          type: "ob.grant.updated",
          at: 100,
          actor,
          principal: actor,
          thread: null,
          message: null,
          channel: null,
          visibility: 2,
          payload: {
            grant: {
              id: "g2",
              principals: [...principals],
              can: { dev: ["read"] },
              capped: false,
              by: actor,
              at: null,
            },
          },
        },
      ]),
    );
    expect(await driver.board(scope).connection(connection)).toMatchObject({
      connection: { grant: "g4", can: { ops: ["read"] } },
      effectiveCan: { ops: ["read"], dev: ["read"] },
    });
    using inspector = new Database(join(dir, "board.db"));
    expect(inspector.query("SELECT grant_id, org_id FROM grant_principals ORDER BY grant_id").all()).toEqual([
      { grant_id: 2, org_id: 1 },
      { grant_id: 4, org_id: null },
    ]);
  } finally {
    await driver.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a new writer counts events appended by a pre-quota writer during an upgrade", async () => {
  const dir = mkdtempSync("openboard-legacy-events-");
  const scope = testScope({ orgId: 1, boardId: 1 });
  const driver = sqliteDriver({ dir }, () => 100);
  const actor = "ob:user:local-dev";
  const write = (path: string) =>
    driver.board(scope).write((writer) =>
      writer.append([
        {
          id: writer.head + 1,
          type: "channel.created",
          at: 100,
          actor,
          principal: actor,
          thread: null,
          message: null,
          channel: path,
          visibility: 1,
          payload: { channel: path, by: { actor, principal: actor, profile: null } },
        },
      ]),
    );
  try {
    await driver.platform().setOrgQuotas(scope.orgId, { eventsPerBoardPerDay: 2 });
    await write("first");

    // The old writer appends and advances the board head without touching the tally.
    using database = new Database(join(dir, "board.db"));
    database.transaction(() => {
      database.run(`INSERT INTO events (org_id, board_id, id, type, at, channel, actor, principal, visibility, payload)
        SELECT org_id, board_id, 2, type, at, 'legacy', actor, principal, visibility, json_set(payload, '$.channel', 'legacy')
        FROM events WHERE org_id = 1 AND board_id = 1 AND id = 1`);
      database.run("UPDATE boards SET head = 2, stored_bytes_head = 2 WHERE org_id = 1 AND id = 1");
    })();

    await expect(write("refused")).rejects.toMatchObject({ code: "quota_exceeded", reason: "daily_events" });
    expect(database.query("SELECT id FROM events ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
  } finally {
    await driver.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a new rate window prunes expired counters after the clock-skew grace period", async () => {
  const dir = mkdtempSync("openboard-rate-counters-");
  try {
    const store = sqliteDriver({ dir });
    const limits = store.platform();
    try {
      await limits.takeRate("sign-in:old", 30, 60_000, 0);
      await limits.takeRate("longer-window", 30, 120_000, 0);
      await limits.takeRate("sign-in:new", 30, 60_000, 60_000);
      expect(await limits.takeRate("sign-in:old", 1, 60_000, 59_999)).toBe(1);
      await limits.takeRate("sign-in:new", 30, 60_000, 120_000);
    } finally {
      await store.close();
    }

    const database = new Database(join(dir, "board.db"), { readonly: true });
    try {
      expect(database.query("SELECT key, window_start FROM rate_counters ORDER BY key, window_start").all()).toEqual([
        { key: "longer-window", window_start: 0 },
        { key: "sign-in:new", window_start: 60_000 },
        { key: "sign-in:new", window_start: 120_000 },
      ]);
    } finally {
      database.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startup queues one job per board and the backfill drains a soft-deleted org in batches", async () => {
  const dir = mkdtempSync("openboard-org-backfill-");
  const driver = sqliteDriver({ dir }, () => 100);
  const org = driver.org(testOrgScope(1));
  const lease = { instanceId: "worker", claimedAt: 100 };
  const jobKind = BACKFILL_BOARD_ORG_JOB;
  try {
    using database = new Database(join(dir, "board.db"));
    database.run(
      "INSERT INTO grant_principals (board_id, grant_id, kind, key, detail) VALUES (1, 4, 'all-users', '', '{}')",
    );
    database.run(`WITH RECURSIVE ids(id) AS (VALUES (1) UNION ALL SELECT id + 1 FROM ids WHERE id < 1001)
      INSERT INTO task_needs (board_id, task, needs) SELECT 1, id, 0 FROM ids`);
    await Promise.all([driver.platform().queueBoardOrgBackfill(100), driver.platform().queueBoardOrgBackfill(100)]);
    const job = (await driver.jobs.claim([jobKind], lease)).job;
    if (!job) throw new Error("missing backfill job");
    expect(job).toMatchObject({ orgId: 1, boardId: 1 });
    expect((await driver.jobs.claim([jobKind], lease)).job).toBeNull();

    // Tombstoned boards and organizations still retain their rows after deletion.
    database.run("UPDATE boards SET deleted_at = 100 WHERE id = 1");
    database.run("UPDATE orgs SET deleted_at = 100 WHERE id = 1");
    expect(await org.backfillBoardOrgIds(1, job.id, lease, 100)).toBe(true);
    expect(await org.backfillBoardOrgIds(1, job.id, lease, 100)).toBe(false);
    expect(database.query("SELECT count(*) AS remaining FROM task_needs WHERE org_id IS NULL").get()).toEqual({
      remaining: 1,
    });
    const next = (await driver.jobs.claim([jobKind], lease)).job;
    if (!next) throw new Error("missing continuation job");
    expect(await org.backfillBoardOrgIds(1, next.id, lease, 100)).toBe(true);
    expect(database.query("SELECT DISTINCT org_id FROM task_needs").all()).toEqual([{ org_id: 1 }]);
    expect(database.query("SELECT org_id FROM grant_principals").get()).toEqual({ org_id: 1 });
    await driver.platform().queueBoardOrgBackfill(100);
    expect((await driver.jobs.claim([jobKind], lease)).job).toBeNull();
  } finally {
    await driver.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("classifies a native busy error as unavailable and rolls back the board write", async () => {
  const dir = mkdtempSync("openboard-busy-");
  const scope = testScope({ orgId: 1, boardId: 1 });
  const actor = "ob:user:local-dev";
  const driver = sqliteDriver({ dir });
  try {
    // This connection has no busy wait. The driver holds the transaction's write lock.
    using contender = new Database(join(dir, "board.db"));
    contender.run("PRAGMA busy_timeout = 0");
    await expect(
      driver.board(scope).write(async (writer) => {
        await writer.append([
          {
            id: writer.head + 1,
            type: "channel.created",
            at: 100,
            actor,
            principal: actor,
            thread: null,
            message: null,
            channel: "busy",
            visibility: 1,
            payload: { channel: "busy", by: { actor, principal: actor, profile: null } },
          },
        ]);
        contender.run("BEGIN IMMEDIATE");
      }),
    ).rejects.toMatchObject({ status: 503, code: "unavailable" });
    expect(await driver.board(scope).write(async (writer) => writer.head)).toBe(0);
  } finally {
    await driver.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
