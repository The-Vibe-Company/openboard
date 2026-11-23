import { expect, test } from "bun:test";
import { checkSqliteRendering } from "../../../migrations.ts";

test("names the migration and an unmapped type in a rendered table", async () => {
  const file = "0002-unsupported-type.sql";
  const sql = await Bun.file(new URL(file, import.meta.url)).text();
  expect(checkSqliteRendering(file, sql)).toEqual([
    "0002-unsupported-type.sql: column type TIMESTAMPTZ has no SQLite rendering",
  ]);
});

test("checks added columns, including multiword types and nested commas", () => {
  const sql = 'ALTER TABLE "events" ADD COLUMN "timestamps" TIMESTAMP WITH TIME ZONE, ADD COLUMN tags TEXT[];';
  expect(checkSqliteRendering("alter.sql", sql)).toEqual([
    "alter.sql: column type TIMESTAMP WITH TIME ZONE has no SQLite rendering",
    "alter.sql: column type TEXT [ ] has no SQLite rendering",
  ]);
});

test("accepts mapped types and ignores type names in constraints, literals and identifiers", () => {
  const sql = `
    CREATE TABLE samples (
      TIMESTAMPTZ BIGINT, bytes BYTEA, label TEXT DEFAULT 'TIMESTAMPTZ',
      PRIMARY KEY (TIMESTAMPTZ, bytes), CHECK (label IN ('TIMESTAMPTZ', 'TEXT'))
    );
    ALTER TABLE samples ADD COLUMN score SMALLINT DEFAULT 0;
  `;
  expect(checkSqliteRendering("valid.sql", sql)).toEqual([]);
});

test("checks the declaration even when a default contains PostgreSQL index syntax", () => {
  const sql = "CREATE TABLE samples (created_at timestamptz, label TEXT DEFAULT 'USING gin');";
  expect(checkSqliteRendering("default.sql", sql)).toEqual([
    "default.sql: column type timestamptz has no SQLite rendering",
  ]);
});

test("checks qualified table declarations and type changes even during the contract phase", () => {
  const sql = `
    -- contract-phase
    CREATE UNLOGGED TABLE sample (exclude TIMESTAMPTZ);
    CREATE GLOBAL TEMPORARY TABLE session_data (payload JSONB);
    ALTER TABLE sample ADD COLUMN exclude UUID;
    ALTER TABLE sample ALTER COLUMN exclude SET DATA TYPE TIMESTAMPTZ USING exclude::TIMESTAMPTZ;
  `;
  expect(checkSqliteRendering("qualified.sql", sql)).toEqual([
    "qualified.sql: column type TIMESTAMPTZ has no SQLite rendering",
    "qualified.sql: column type JSONB has no SQLite rendering",
    "qualified.sql: column type UUID has no SQLite rendering",
    "qualified.sql: column type TIMESTAMPTZ has no SQLite rendering",
  ]);
});

test("ignores table constraint expressions and clauses after the column list", () => {
  const sql = `
    CREATE TABLE samples (id INTEGER, EXCLUDE USING gist (id WITH =));
    CREATE TABLE more_samples (id INTEGER) PARTITION BY RANGE (id);
    CREATE TABLE copied AS SELECT count(*) FROM samples;
  `;
  expect(checkSqliteRendering("table.sql", sql)).toEqual([]);
});
