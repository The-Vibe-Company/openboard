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
