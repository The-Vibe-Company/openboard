import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  checkAppliedMigrations,
  checkDestructiveMigration,
  checkMigrationNumbers,
  parseMigrationTree,
} from "./migrations";

const editedFixtures = join(import.meta.dir, "fixtures", "migrations", "edited");

test("names all files sharing a migration number", () => {
  expect(checkMigrationNumbers(["0002-second.sql", "0002-first.sql"], [])).toEqual([
    "duplicate migration number 0002: 0002-first.sql, 0002-second.sql",
  ]);
});

test("names new migrations at or below main's newest number", () => {
  expect(
    checkMigrationNumbers(
      ["0002-backfill.sql", "0003-existing.sql", "0003-collision.sql", "0004-new.sql"],
      ["0003-existing.sql"],
    ),
  ).toEqual([
    "0002-backfill.sql: migration number must be newer than main's 0003",
    "0003-collision.sql: migration number must be newer than main's 0003",
    "duplicate migration number 0003: 0003-collision.sql, 0003-existing.sql",
  ]);
});

test("accepts the first migration and ignores files outside the naming convention", () => {
  expect(checkMigrationNumbers(["0001-first.sql", "0001-notes.md"], [])).toEqual([]);
});

async function readMigrations(side: "main" | "branch"): Promise<Map<string, string>> {
  const directory = join(editedFixtures, side, "packages", "driver-sql", "migrations");
  const files = (await readdir(directory)).sort();
  return new Map(
    await Promise.all(files.map(async (file) => [file, await readFile(join(directory, file), "utf8")] as const)),
  );
}

test("names an applied migration whose content changed by one byte", async () => {
  expect(checkAppliedMigrations(await readMigrations("branch"), await readMigrations("main"))).toEqual([
    "0001-create-boards.sql: migration is applied on main and must not be edited; add a new migration instead",
  ]);
});

test("names an applied migration that was removed", () => {
  expect(
    checkAppliedMigrations(
      new Map([["0002-second.sql", "b"]]),
      new Map([
        ["0001-first.sql", "a"],
        ["0002-second.sql", "b"],
      ]),
    ),
  ).toEqual(["0001-first.sql: migration is applied on main and must not be removed; add a new migration instead"]);
});

test("accepts unchanged applied migrations, new migrations and non-migration files", () => {
  expect(
    checkAppliedMigrations(
      new Map([
        ["0001-first.sql", "a"],
        ["0002-new.sql", "c"],
      ]),
      new Map([
        ["0001-first.sql", "a"],
        ["README.md", "x"],
      ]),
    ),
  ).toEqual([]);
});

test("reads regular migration files from ls-tree output and skips everything else", () => {
  const directory = "packages/driver-sql/migrations";
  const output = [
    `100644 blob aaa\t${directory}/0001-first.sql`,
    `100755 blob bbb\t${directory}/0002-second.sql`,
    `120000 blob ccc\t${directory}/0003-link.sql`,
    `160000 commit ddd\t${directory}/vendor`,
    `100644 blob eee\t${directory}/nested/0004-deep.sql`,
    `100644 blob fff\tpackages/driver-sql/migrations-old/0005-other.sql`,
    "",
  ].join("\0");
  expect(parseMigrationTree(output)).toEqual(
    new Map([
      ["0001-first.sql", "aaa"],
      ["0002-second.sql", "bbb"],
    ]),
  );
});

const destructiveFixture = "0001-destructive.sql";

async function readDestructiveFixture(): Promise<string> {
  return readFile(join(import.meta.dir, "fixtures", "migrations", "destructive", destructiveFixture), "utf8");
}

test("names each destructive statement without a contract-phase marker", async () => {
  expect(checkDestructiveMigration(destructiveFixture, await readDestructiveFixture())).toEqual(
    [
      "DROP TABLE obsolete",
      "ALTER TABLE boards RENAME COLUMN title TO name",
      "ALTER TABLE boards ALTER COLUMN id TYPE bigint",
      'ALTER TABLE ONLY public."boards" ALTER COLUMN name SET NOT NULL',
    ].map((statement) => `${destructiveFixture}: destructive migration requires -- contract-phase: ${statement}`),
  );
});

test("accepts the same destructive statements with a standalone contract-phase marker", async () => {
  expect(checkDestructiveMigration(destructiveFixture, `-- contract-phase\n${await readDestructiveFixture()}`)).toEqual(
    [],
  );
});

test("ignores destructive words inside comments, literals and identifiers", () => {
  const sql = `/* outer /* nested */ DROP TABLE boards; */
-- ALTER TABLE boards RENAME TO old;
ALTER TABLE boards ADD COLUMN "DROP" text DEFAULT $$'; DROP TABLE boards;$$;
ALTER TABLE boards ADD COLUMN rename text DEFAULT 'ALTER TABLE boards ALTER id TYPE text;';
ALTER TABLE boards ADD COLUMN type text DEFAULT E'escaped \\' quote ; DROP TABLE boards;';
ALTER TABLE boards ADD COLUMN description text;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toEqual([]);
});

test("rejects a marker embedded in quoted text or block comments", () => {
  const sql = `/*
-- contract-phase
*/
SELECT $body$
-- contract-phase
$body$;
DROP TABLE boards;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toHaveLength(1);
});

test("recognizes mixed-case destructive actions after an additive action", () => {
  const sql = "alter table if exists boards add column tags numeric(4, 1), alter id set /* cast */ data type bigint;";
  expect(checkDestructiveMigration(destructiveFixture, sql)).toHaveLength(1);
});

test("allows SET NOT NULL with an explicit default for the same column in the ALTER TABLE", () => {
  const sql = `ALTER TABLE boards ALTER COLUMN "name" SET DEFAULT 'untitled', ALTER name SET NOT NULL;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toEqual([]);
});

test("rejects SET NOT NULL when the default belongs to a different column", () => {
  const sql = "ALTER TABLE boards ALTER title SET DEFAULT '', ALTER name SET NOT NULL;";
  expect(checkDestructiveMigration(destructiveFixture, sql)).toHaveLength(1);
});

test.each(["ONLY (public.boards)", 'U&"boards"', "U&\"boards\" UESCAPE '!'"])(
  "checks destructive ALTER TABLE actions on %s",
  (table) => {
    expect(checkDestructiveMigration(destructiveFixture, `ALTER TABLE ${table} DROP COLUMN title;`)).toHaveLength(1);
  },
);

test("rejects a marker inside the continuation of an escape string", () => {
  const sql = String.raw`SELECT E'first'
  'next\'
-- contract-phase
last';
DROP TABLE boards;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toEqual([
    `${destructiveFixture}: destructive migration requires -- contract-phase: DROP TABLE boards`,
  ]);
});

test("rejects SET NOT NULL when the default is explicitly null", () => {
  const sql = "ALTER TABLE boards ALTER name SET DEFAULT (NULL), ALTER name SET NOT NULL;";
  expect(checkDestructiveMigration(destructiveFixture, sql)).toHaveLength(1);
});

test("allows tightening a column after setting its default earlier in the file", () => {
  const sql = `ALTER TABLE public.boards ALTER COLUMN "name" SET DEFAULT 'untitled';
ALTER TABLE "public"."boards" ALTER name SET NOT NULL;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toEqual([]);
});

test.each([
  "ALTER VIEW board_titles RENAME title TO name;",
  "ALTER MATERIALIZED VIEW board_titles RENAME title TO name;",
  "ALTER FOREIGN TABLE boards DROP COLUMN name;",
  "ALTER TABLE boards ALTER COLUMN id DROP IDENTITY;",
])("rejects %s without the marker", (sql) => {
  expect(checkDestructiveMigration(destructiveFixture, sql)).toHaveLength(1);
});

test("rejects SET NOT NULL when the default casts an explicit null", () => {
  const sql = "ALTER TABLE boards ALTER name SET DEFAULT CAST(NULL AS text), ALTER name SET NOT NULL;";
  expect(checkDestructiveMigration(destructiveFixture, sql)).toHaveLength(1);
});

test("allows an ALTER with a configuration key containing rename", () => {
  const sql = "ALTER DATABASE openboard SET app.rename TO 'on';";
  expect(checkDestructiveMigration(destructiveFixture, sql)).toEqual([]);
});

test("preserves the original whitespace in the statement name", () => {
  expect(checkDestructiveMigration(destructiveFixture, 'DROP TABLE "old  boards";')).toEqual([
    `${destructiveFixture}: destructive migration requires -- contract-phase: DROP TABLE "old  boards"`,
  ]);
});

test("ignores markers inside a dollar tag containing a combining mark", () => {
  const sql = `SELECT $cafe\u0301$
-- contract-phase
$cafe\u0301$;
DROP TABLE boards;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toHaveLength(1);
});

test("checks destructive ALTER TABLE actions on names containing combining marks", () => {
  expect(checkDestructiveMigration(destructiveFixture, "ALTER TABLE cafe\u0301 DROP COLUMN title;")).toHaveLength(1);
});

test("allows tightening a column introduced with an explicit default earlier in the file", () => {
  const sql = `ALTER TABLE boards ADD COLUMN name text DEFAULT 'untitled';
ALTER TABLE boards ALTER name SET NOT NULL;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toEqual([]);
});

test("requires a marker if the default only applies to the parent table", () => {
  const sql = `ALTER TABLE ONLY boards ALTER title SET DEFAULT '';
ALTER TABLE boards ALTER title SET NOT NULL;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toHaveLength(1);
});

test("does not reuse defaults after a search path change", () => {
  const sql = `ALTER TABLE boards ALTER title SET DEFAULT '';
SET search_path TO another_schema;
ALTER TABLE boards ALTER title SET NOT NULL;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toHaveLength(1);
});

test("matches Unicode-escaped and ordinary spellings of the same identifier", () => {
  const sql = String.raw`ALTER TABLE U&"!0062oards" UESCAPE '!' ALTER COLUMN U&"tit\006Ce" SET DEFAULT '';
ALTER TABLE boards ALTER title SET NOT NULL;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toEqual([]);
});

test.each(["ALTER DOMAIN title_text SET NOT NULL;", "ALTER TYPE board_info ALTER ATTRIBUTE title TYPE varchar(80);"])(
  "rejects %s without the marker",
  (sql) => {
    expect(checkDestructiveMigration(destructiveFixture, sql)).toHaveLength(1);
  },
);

test("rejects a recursive tightening after the parent default is cleared", () => {
  const sql = `ALTER TABLE boards ALTER title SET DEFAULT '';
ALTER TABLE ONLY boards ALTER title SET DEFAULT NULL;
ALTER TABLE boards ALTER title SET NOT NULL;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toHaveLength(1);
});

test("uses a recursive default for a parent-only tightening", () => {
  const sql = `ALTER TABLE boards ALTER title SET DEFAULT '';
ALTER TABLE ONLY boards ALTER title SET NOT NULL;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toEqual([]);
});

test("rejects the SET DATA TYPE spelling for a composite attribute", () => {
  const sql = "ALTER TYPE board_info ALTER ATTRIBUTE title SET DATA TYPE varchar(80);";
  expect(checkDestructiveMigration(destructiveFixture, sql)).toHaveLength(1);
});

test("retains defaults across unrelated session settings", () => {
  const sql = `ALTER TABLE public.boards ALTER title SET DEFAULT '';
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.boards ALTER title SET NOT NULL;`;
  expect(checkDestructiveMigration(destructiveFixture, sql)).toEqual([]);
});
