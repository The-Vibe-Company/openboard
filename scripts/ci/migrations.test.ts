import { expect, test } from "bun:test";
import { checkMigrationNumbers } from "./migrations";

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
