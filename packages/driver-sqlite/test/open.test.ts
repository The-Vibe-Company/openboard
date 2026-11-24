import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { testScope } from "@openboard/ports/testkit";
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
      expect(database.query("SELECT version, applied_at FROM schema_migrations").all()).toEqual([
        { version: 1, applied_at: 100 },
        { version: 2, applied_at: 100 },
        { version: 3, applied_at: 100 },
        { version: 4, applied_at: 100 },
        { version: 5, applied_at: 100 },
        { version: 6, applied_at: 100 },
        { version: 7, applied_at: 100 },
        { version: 8, applied_at: 100 },
        { version: 9, applied_at: 100 },
        { version: 10, applied_at: 100 },
        { version: 11, applied_at: 100 },
        { version: 12, applied_at: 100 },
        { version: 13, applied_at: 100 },
        { version: 14, applied_at: 100 },
      ]);
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
  } finally {
    await driver.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
