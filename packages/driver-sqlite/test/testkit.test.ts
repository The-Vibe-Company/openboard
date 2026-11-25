import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { ratesSuite, runBlobsSuite, runJobsSuite, runJobWakeSuite, runStoreSuite } from "@openboard/ports/testkit";
import { sqlitePurgeFixture } from "../src/catalog.ts";
import { renderDdl } from "../src/ddl.ts";
import { sqliteDriver } from "../src/index.ts";

const open = async () => sqliteDriver({ memory: true }, () => 0);
runStoreSuite("sqlite", open, async () => sqlitePurgeFixture(() => 0));
runBlobsSuite("sqlite", open);
runJobsSuite("sqlite", open);
runJobWakeSuite("sqlite", async (now, run) => {
  const store = sqliteDriver({ memory: true }, now);
  try {
    await run(store);
  } finally {
    await store.close();
  }
});
ratesSuite("sqlite", async (run) => {
  const dir = mkdtempSync("openboard-rates-");
  try {
    const options = { dir, scheduleSnapshot: () => () => {} };
    const first = sqliteDriver(options, () => 0);
    try {
      const second = sqliteDriver(options, () => 0);
      try {
        await run(first, second);
      } finally {
        await second.close();
      }
    } finally {
      await first.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("rendering Postgres DDL for SQLite", () => {
  test("applies the mechanical differences", () => {
    const postgres = `CREATE EXTENSION pg_trgm;
      CREATE TABLE orgs (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, n SMALLINT NOT NULL, b BYTEA); -- note
      CREATE TABLE events (board_id BIGINT NOT NULL, id BIGINT NOT NULL, PRIMARY KEY (board_id, id));
      CREATE INDEX CONCURRENTLY events_id ON events (board_id, id);
      CREATE INDEX messages_text_trgm ON messages USING gin (text_lower gin_trgm_ops);`;
    expect(renderDdl(postgres).split("\n")).toEqual([
      "CREATE TABLE orgs (id INTEGER PRIMARY KEY, n INTEGER NOT NULL, b BLOB) STRICT;",
      "CREATE TABLE events (board_id INTEGER NOT NULL, id INTEGER NOT NULL, PRIMARY KEY (board_id, id)) STRICT, WITHOUT ROWID;",
      "CREATE INDEX events_id ON events (board_id, id);",
    ]);
  });
});
