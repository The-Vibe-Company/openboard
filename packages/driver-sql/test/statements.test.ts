import { describe, expect, test } from "bun:test";
import { filtersOnTenant, platformStatements, statements, unscopedStatements } from "../src/statements.ts";

describe("statement registry", () => {
  test("every registered statement filters on board_id or org_id, or is a platform statement", () => {
    expect(unscopedStatements(statements, platformStatements)).toEqual([]);
  });

  test("every platform statement is registered", () => {
    expect([...platformStatements].filter((name) => !(name in statements))).toEqual([]);
  });
});

describe("unscopedStatements", () => {
  test("names a statement that filters on no tenant", () => {
    const registry = { messageById: "SELECT id FROM messages WHERE id = ?" };
    expect(unscopedStatements(registry, new Set())).toEqual(["messageById"]);
  });

  test("passes a statement listed as a platform statement", () => {
    const registry = { accountByEmail: "SELECT id FROM accounts WHERE email = $1" };
    expect(unscopedStatements(registry, new Set(["accountByEmail"]))).toEqual([]);
  });
});

describe("filtersOnTenant", () => {
  test.each([
    "SELECT id FROM messages WHERE board_id = ? AND id = ?",
    "SELECT id FROM boards WHERE org_id = $1 AND slug = $2",
    "SELECT m.id FROM messages m JOIN threads t ON t.id = m.thread_id WHERE m.board_id = $1",
    "UPDATE tasks SET state = $1 WHERE board_id = $2 AND id = $3",
    "DELETE FROM grants WHERE org_id = $1 AND id = $2",
    "INSERT INTO messages (board_id, org_id, id, body) VALUES ($1, $2, $3, $4)",
  ])("passes %p", (sql) => {
    expect(filtersOnTenant(sql)).toBe(true);
  });

  test.each([
    "SELECT id FROM messages WHERE id = ?",
    "SELECT id FROM messages",
    "SELECT id FROM messages WHERE body = 'board_id = 1'",
    "SELECT id FROM messages WHERE id = $1 -- board_id = $2",
    "SELECT id FROM messages WHERE id = $1 /* org_id = $2 */",
    "SELECT board_id FROM messages WHERE id = $1",
    "UPDATE tasks SET board_id = $1 WHERE id = $2",
    "DELETE FROM grants WHERE grant_org_id = $1",
    "INSERT INTO messages (id, body) VALUES ($1, $2)",
  ])("refuses %p", (sql) => {
    expect(filtersOnTenant(sql)).toBe(false);
  });
});
