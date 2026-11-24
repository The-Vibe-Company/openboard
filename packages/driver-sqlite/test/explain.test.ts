import { Database, type SQLQueryBindings } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { migrations, renderStatements } from "@openboard/driver-sql";
import { sqliteDialect } from "../src/dialect.ts";
import { migrate } from "../src/migrate.ts";

// docs/data-model.md "The store port", point 2: every registered statement compiles on SQLite, reached by a test or not.
const database = new Database(":memory:", { strict: true });
migrate(database, migrations, 0);
afterAll(() => database.close());

describe("EXPLAIN on SQLite", () => {
  test.each(Object.entries(renderStatements(sqliteDialect)))("%s", (_name, { text, params }) => {
    const values: SQLQueryBindings[] = Array.from({ length: params }, () => null);
    expect(database.query(`EXPLAIN ${text}`).all(...values).length).toBeGreaterThan(0);
  });
});

test("replacing a task's edges also removes its legacy edges awaiting org backfill", () => {
  using legacy = new Database(":memory:", { strict: true });
  migrate(legacy, migrations, 0);
  legacy.run(`INSERT INTO task_needs (org_id, board_id, task, needs)
    VALUES (NULL, 1, 4, 2), (1, 1, 4, 3), (NULL, 2, 4, 2), (1, 1, 5, 2)`);
  const statement = renderStatements(sqliteDialect).deleteTaskNeeds;
  if (!statement) throw new Error("missing prerequisite deletion statement");
  legacy.run(statement.text, [1, 1, 4]);
  expect(legacy.query("SELECT board_id, task, needs FROM task_needs ORDER BY board_id, task").all()).toEqual([
    { board_id: 1, task: 5, needs: 2 },
    { board_id: 2, task: 4, needs: 2 },
  ]);
});
