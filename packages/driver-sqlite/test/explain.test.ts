import { Database, type SQLQueryBindings } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { createViews, localBroadcaster, migrations, renderStatements } from "@openboard/driver-sql";
import { testScope } from "@openboard/ports/testkit";
import { sqliteDialect } from "../src/dialect.ts";
import { migrate } from "../src/migrate.ts";
import { connection } from "../src/open.ts";

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

test.each([
  ["listLatestTasksByState", "tasks_ready", "board_id=? AND channel=? AND state=? AND id>?"],
  ["listLatestSubtreeTasksByState", "tasks_board_state", "board_id=? AND state=? AND id>?"],
  ["listLatestBoardTasksByState", "tasks_board_state", "board_id=? AND state=? AND id>?"],
])("%s seeks stored states before sorting by activity", (name, index, keys) => {
  const statement = renderStatements(sqliteDialect)[name];
  if (!statement) throw new Error(`missing statement ${name}`);
  const values: SQLQueryBindings[] = Array.from({ length: statement.params }, () => null);
  const plan = database.query<{ detail: string }, SQLQueryBindings[]>(`EXPLAIN QUERY PLAN ${statement.text}`);
  expect(plan.all(...values).map(({ detail }) => detail)).toContain(`SEARCH t USING INDEX ${index} (${keys})`);
});

test("latest task lists match expired held claims only as blocked", async () => {
  using fixture = new Database(":memory:", { strict: true });
  migrate(fixture, migrations, 0);
  fixture.exec(`
    INSERT INTO boards (id, org_id, slug, name, head, created_at) VALUES (1, 1, 'main', 'Main', 2, 0);
    INSERT INTO tasks (org_id, board_id, id, channel, state, owner, by_actor, claim_until, blocked_reason, created_at)
      VALUES (1, 1, 2, 'dev', 'claimed', 'owner', 'owner', 100, 'held', 0);
    INSERT INTO messages (org_id, board_id, id, channel, actor, principal, text, text_lower,
      no_sync, version, created_at, active, view)
      VALUES (1, 1, 2, 'dev', 'owner', 'owner', '', '', 0, 2, 0, 2,
        '{"id":"2","task":{"state":"claimed","claim":{"until":"1970-01-01T00:00:00.100Z"},"blocked":{"reason":"held"}}}');
  `);
  const db = connection(fixture, undefined, () => undefined);
  const store = createViews(db, sqliteDialect, localBroadcaster(), { now: () => 100, committed() {} });
  const board = store.board(testScope({ orgId: 1, boardId: 1 }));
  const list = (state: string) => board.listTasks({ states: [state], latest: true, limit: 1 });
  expect((await list("blocked")).tasks.map(({ message }) => message.task?.state)).toEqual(["blocked"]);
  expect((await list("ready")).tasks).toEqual([]);
  expect((await list("claimed")).tasks).toEqual([]);
});
