import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrations } from "@openboard/driver-sql";
import { migrate } from "../src/migrate.ts";

test("upgrades the SQLite delivery table and preserves existing rows and indexes", () => {
  using database = new Database();
  migrate(
    database,
    migrations.filter(({ version }) => version <= 32),
    0,
  );
  database.run(`INSERT INTO webhook_deliveries
    (id, org_id, board_id, webhook, event, thread, state, attempt, next_at, created_at, root_view)
    VALUES ('event-delivery', 1, 2, 'hook', 6, 5, 'sending', 1, 10, 1, '{}')`);
  const deliveries = () => database.query("SELECT * FROM webhook_deliveries ORDER BY id").all();
  const [previous] = deliveries();
  const indexes = () => database.query("PRAGMA index_list(webhook_deliveries)").all();
  const previousIndexes = indexes();

  migrate(database, migrations, 10);
  database.run(`INSERT INTO webhook_deliveries
    (id, org_id, board_id, webhook, event, thread, state, attempt, next_at, created_at, type)
    VALUES ('ping-delivery', 1, 2, 'hook', NULL, NULL, 'done', 1, 10, 10, 'board.ping')`);
  expect(deliveries()).toMatchObject([
    { ...(previous as object), type: "board.event" },
    { event: null, thread: null, type: "board.ping" },
  ]);
  expect(indexes()).toEqual(previousIndexes);
});
