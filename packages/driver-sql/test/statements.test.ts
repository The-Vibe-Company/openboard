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
    "INSERT INTO messages (board_id, id) VALUES ($1, $2), ($1, $3) ON CONFLICT (board_id, id) DO NOTHING",
    "INSERT INTO messages (board_id, id) SELECT $1, id FROM drafts WHERE board_id = $1",
    "WITH s AS (SELECT id FROM tasks WHERE board_id = $1) SELECT id FROM messages WHERE board_id = $1",
    "SELECT id FROM messages WHERE board_id = $1 UNION ALL SELECT id FROM tasks WHERE board_id = $1",
    "SELECT id FROM messages WHERE board_id = $1 AND thread_id IN (SELECT id FROM threads WHERE board_id = $1)",
    `SELECT id FROM messages WHERE "board_id" = $1::bigint AND body <> E'it''s or \\' x' ORDER BY id LIMIT 10`,
    "SELECT id FROM messages WHERE $1 = board_id AND created_at >= $2 FOR UPDATE;",
    "INSERT INTO messages (board_id, id, body) VALUES ($1, $2, $3) ON CONFLICT (board_id, id) DO UPDATE SET body = $3",
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
    "SELECT id FROM messages WHERE id = $1 OR board_id = $2",
    "DELETE FROM messages WHERE id = $1 OR org_id = $2",
    "SELECT id FROM messages WHERE id = $1 AND (board_id = $2 OR TRUE)",
    "SELECT id FROM messages WHERE id = $1 AND NOT board_id = $2",
    "SELECT id FROM messages WHERE id IN (SELECT id FROM threads WHERE board_id = $1)",
    "SELECT id FROM messages WHERE board_id = $1 AND id IN (SELECT message_id FROM reactions WHERE id = $2)",
    "WITH s AS (SELECT id FROM tasks WHERE board_id = $1) SELECT id FROM messages WHERE id = $2",
    "WITH d AS (DELETE FROM messages WHERE id = $2 RETURNING id) SELECT id FROM tasks WHERE board_id = $1",
    "SELECT id FROM messages WHERE board_id = $1 UNION ALL SELECT id FROM messages WHERE id = $2",
    "SELECT id FROM messages WHERE body = $$board_id = $1$$",
    "SELECT id FROM messages WHERE body = $q$board_id = $1$q$",
    "SELECT id FROM messages WHERE body = E'\\' or board_id = $1 --'",
    "INSERT INTO messages (board_id, id) VALUES (NULL, $1)",
    "INSERT INTO messages (board_id, id) VALUES ($1, $2), (5, $3)",
    "INSERT INTO messages (board_id) SELECT 1 FROM drafts WHERE board_id = $1",
    "INSERT INTO messages (board_id, id) SELECT $1, id FROM drafts",
    "SELECT id FROM messages WHERE board_id = $1; DELETE FROM messages",
    "SELECT id FROM messages WHERE board_id = $1 AND body = 'unterminated",
    "SELECT id FROM messages WHERE board_id = $1 AND id = (1",
    "SELECT id FROM messages WHERE board_id = $1 AND id IN (TABLE secrets)",
    'SELECT id FROM"messages"',
    'SELECT id FROM messages WHERE board_id = $1 AND "a" = 1 OR"b" = 2',
    'SELECT id FROM messages WHERE "a and board_id" = $1',
    "INSERT INTO messages (board_id, id) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET body = $3 RETURNING *",
    "INSERT INTO messages (board_id, id) VALUES ($1, $2) ON CONFLICT (board_id, id) DO UPDATE SET board_id = $3",
    "INSERT INTO messages (board_id, id) VALUES ($1, $2) ON CONFLICT ON CONSTRAINT messages_pkey DO NOTHING",
    "SELECT id FROM messages WHERE id = $1 /* /* */ AND board_id = $2 -- */\n",
    "WITH d AS (MERGE INTO messages USING drafts ON true WHEN MATCHED THEN DELETE RETURNING *) SELECT id FROM tasks WHERE board_id = $1",
    "INSERT INTO messages (board_id, id) VALUES ($1, $2) ON CONFLICT (board_id, id) DO UPDATE SET (board_id, body) = ($3, $4)",
    'SELECT id FROM messages WHERE "Board_ID" = $1',
  ])("refuses %p", (sql) => {
    expect(filtersOnTenant(sql)).toBe(false);
  });
});
