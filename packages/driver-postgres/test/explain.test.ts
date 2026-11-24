import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { postgresText, renderStatements } from "@openboard/driver-sql";
import { SQL } from "bun";
import { createTestDatabases } from "../src/database.ts";
import { connection } from "../src/pool.ts";
import { postgresTestUrl } from "./support/env.ts";

// docs/data-model.md "The store port", point 2: every registered statement parses and plans on Postgres, reached by a
// test or not. `NULL` is bound for every parameter, so a parameter Postgres cannot type needs a cast in the statement.
const url = postgresTestUrl();
if (url) {
  let databases: Awaited<ReturnType<typeof createTestDatabases>>;
  let clone: { url: string; drop: () => Promise<void> };
  let sql: SQL;
  beforeAll(async () => {
    databases = await createTestDatabases(url);
    clone = await databases.create();
    sql = new SQL({ url: clone.url, max: 1 });
  });
  afterAll(async () => {
    try {
      await sql.close();
      await clone.drop();
    } finally {
      await databases.close();
    }
  });

  describe("EXPLAIN on Postgres", () => {
    test.each(Object.entries(renderStatements(postgresText)))("%s", async (_name, { text, params }) => {
      const rows = await connection(sql).query(
        `EXPLAIN ${text}`,
        Array.from({ length: params }, () => null),
      );
      expect(rows.length).toBeGreaterThan(0);
    });
  });
}
