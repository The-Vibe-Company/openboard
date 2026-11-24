import { type BoardKeys, PURGE_ORG_JOB } from "@openboard/ports";
import type { Db, Dialect, Row } from "./db.ts";
import { query, sql } from "./sql.ts";
import { purgeStatements } from "./views/jobs/purge.ts";

interface Table {
  readonly name: string;
  readonly columns: readonly { readonly name: string }[];
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
const taskNeed = sql`INSERT INTO task_needs (board_id, task, needs)
  VALUES (${"boardId"}, ${"task"}, ${"needs"})`;

export function simulateLegacyDeletion(db: Db, dialect: Dialect, orgId: number) {
  return query(db, dialect, markLegacy, { orgId, kind: PURGE_ORG_JOB });
}

export function seedTaskNeed(db: Db, dialect: Dialect, keys: BoardKeys, task: number, needs: number) {
  return query(db, dialect, taskNeed, { boardId: keys.boardId, task, needs });
}
