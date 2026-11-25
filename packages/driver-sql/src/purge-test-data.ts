import { type BoardKeys, PURGE_ORG_JOB } from "@openboard/ports";
import type { Db, Dialect, Row } from "./db.ts";
import { query, sql } from "./sql.ts";
import { purgeStatements } from "./views/jobs/purge.ts";

interface Table {
  readonly name: string;
  readonly columns: readonly { readonly name: string }[];
}

/** Reads every application table in a dedicated test database. */
export async function databaseRows(db: Pick<Db, "query">, tables: readonly Table[]) {
  return Object.fromEntries(
    await Promise.all(
      tables.map(
        async ({ name }) => [name, await db.query(`SELECT * FROM "${name.replaceAll('"', '""')}"`, [])] as const,
      ),
    ),
  );
}

/** Test evidence from the actual schema and rows, independent of the purge queries. */
export async function tenantRows(
  db: Pick<Db, "query">,
  parameter: string,
  tables: readonly Table[],
  orgId: number,
  boardIds: readonly number[],
) {
  const rows: Record<string, Row[]> = {};
  const missing: string[] = [];
  for (const table of tables) {
    const orgScoped = table.columns.some(({ name }) => name === "org_id");
    const boardScoped = table.columns.some(({ name }) => name === "board_id");
    if (!orgScoped && !boardScoped) continue;
    if (!Object.hasOwn(purgeStatements, `purge_${table.name}`)) missing.push(table.name);
    const name = `"${table.name.replaceAll('"', '""')}"`;
    const column = orgScoped ? "org_id" : "board_id";
    const ids = orgScoped ? [orgId] : boardIds;
    rows[table.name] = (
      await Promise.all(ids.map((id) => db.query(`SELECT * FROM ${name} WHERE ${column} = ${parameter}`, [id])))
    ).flat();
  }
  rows.tenant_rate_counters = await db.query(`SELECT * FROM tenant_rate_counters WHERE org_id = ${parameter}`, [orgId]);
  return { rows, missing };
}

const markLegacy = sql`DELETE FROM jobs WHERE org_id = ${"orgId"} AND kind = ${"kind"}`;
const taskNeed = sql`INSERT INTO task_needs (org_id, board_id, task, needs)
  VALUES (${"orgId"}, ${"boardId"}, ${"task"}, ${"needs"})`;

export function simulateLegacyDeletion(db: Db, dialect: Dialect, orgId: number) {
  return query(db, dialect, markLegacy, { orgId, kind: PURGE_ORG_JOB });
}

export function seedTaskNeed(db: Db, dialect: Dialect, keys: BoardKeys, task: number, needs: number) {
  return query(db, dialect, taskNeed, { ...keys, task, needs });
}

const scheduleState = sql`UPDATE schedules
  SET state = ${"state"}, next_at = NULL, last_message = ${"lastMessage"}, sent = ${"sent"}
  WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`;

/** Seeds a historical schedule for list tests without running the sender or cancel handler. */
export function seedScheduleState(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
  id: number,
  state: "done" | "canceled",
  lastMessage: number | null,
) {
  return query(db, dialect, scheduleState, { ...keys, id, state, lastMessage, sent: lastMessage === null ? 0 : 1 });
}

/** Populate a long log cheaply without adding a statement per setup event. */
export async function seedReprojectLog(db: Db, dialect: Dialect, keys: BoardKeys, count: number) {
  // The fixture uses one parameterized expression for the log size inside the engine-specific row generator.
  const generator =
    dialect.name === "postgres"
      ? "SELECT generate_series(1, $1::bigint)"
      : "WITH RECURSIVE seq(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM seq WHERE id < ?) SELECT id FROM seq";
  const event = `CASE WHEN id % 4096 = 1 THEN 'channel.created' ELSE 'watch.failed' END,
    -86400000, 1, '{}', CASE WHEN id % 4096 = 1 THEN 'history/' || CAST(id AS TEXT) END`;
  const insert =
    dialect.name === "postgres"
      ? `INSERT INTO events (org_id, board_id, id, type, at, visibility, payload, channel)
         SELECT $2, $3, id, ${event} FROM (${generator}) AS positions(id)`
      : `INSERT INTO events (org_id, board_id, id, type, at, visibility, payload, channel)
         SELECT ?, ?, id, ${event} FROM (${generator})`;
  const seed = async (tx: Db) => {
    await tx.query(
      insert,
      dialect.name === "postgres" ? [count, keys.orgId, keys.boardId] : [keys.orgId, keys.boardId, count],
    );
    await query(tx, dialect, sql`UPDATE boards SET head = ${"count"} WHERE org_id = ${"orgId"} AND id = ${"boardId"}`, {
      ...keys,
      count,
    });
  };
  if (dialect.name === "sqlite") return seed(db);
  // The isolated fixture needs the log only. Avoid firing a usage trigger once per synthetic position.
  await db.transaction(async (tx) => {
    await tx.query("ALTER TABLE events DISABLE TRIGGER USER", []);
    await seed(tx);
    await tx.query("ALTER TABLE events ENABLE TRIGGER USER", []);
    await tx.query("ANALYZE events", []);
  });
}
