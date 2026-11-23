import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkAppliedMigrations, checkMigrationNumbers } from "./migrations";

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
