import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrations } from "@openboard/driver-sql";
import { migrate } from "../src/migrate.ts";

test("backfills pending schedules once and preserves jobs already queued by the trigger", () => {
  using database = new Database();
  migrate(
    database,
    migrations.filter(({ version }) => version <= 56),
    0,
  );
  const insert = database.query(`INSERT INTO schedules (
    org_id, board_id, id, channel, text, labels, no_sync, attachments, first_at, next_at, state,
    by_actor, by_principal, creator, created_at, author, mentions, blocks
  ) VALUES (1, 1, ?, 'dev', 'reminder', '{}', 0, '[]', 100, ?, ?, 'fixture', 'fixture', '{}', 0, '{}', '[]', '[]')`);
  insert.run(1, 100, "pending");
  insert.run(2, null, "canceled");

  migrate(
    database,
    migrations.filter(({ version }) => version <= 57),
    10,
  );
  insert.run(3, 300, "pending");
  migrate(database, migrations, 20);

  expect(
    database
      .query("SELECT kind, available_at, payload, job_key FROM jobs WHERE kind = 'schedule-send' ORDER BY job_key")
      .all(),
  ).toEqual([
    { kind: "schedule-send", available_at: 100, payload: '{"id":"1","n":0}', job_key: "1" },
    { kind: "schedule-send", available_at: 300, payload: '{"id":"3","n":0}', job_key: "3" },
  ]);
});
