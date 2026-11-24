import type { BoardKeys } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { type Fragment, forUpdate, query, sql } from "../../sql.ts";

const batchSize = 1000;

function fillBatch(table: "grant_principals" | "task_needs", key: string) {
  const target: Fragment = { fragment: () => table };
  const keys: Fragment = { fragment: () => key };
  return sql`UPDATE ${target} SET org_id = ${"orgId"}
    WHERE board_id = ${"boardId"} AND org_id IS NULL AND (${keys}) IN (
      SELECT ${keys} FROM ${target} WHERE board_id = ${"boardId"} AND org_id IS NULL
      ORDER BY ${keys} LIMIT ${"limit"}
    ) RETURNING 1`;
}

export const backfillPlatformStatements = {
  // Startup discovery returns routing keys only. Each enqueue and effect subsequently takes that board's lock.
  backfillBoardPage: sql`WITH page AS (
    SELECT id, org_id FROM boards WHERE id > ${"after"} ORDER BY id LIMIT 100
  )
  SELECT b.org_id, b.id AS board_id, CASE WHEN
    EXISTS (SELECT 1 FROM grant_principals p WHERE p.board_id = b.id AND p.org_id IS NULL)
    OR EXISTS (SELECT 1 FROM task_needs n WHERE n.board_id = b.id AND n.org_id IS NULL)
    THEN 1 ELSE 0 END AS pending FROM page b ORDER BY b.id`,
};

export const backfillStatements = {
  backfillLockBoard: sql`SELECT id FROM boards WHERE org_id = ${"orgId"} AND id = ${"boardId"}${forUpdate}`,
  queuedBoardOrgBackfill: sql`SELECT 1 FROM jobs
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND kind = ${"kind"} LIMIT 1`,
  fillPrincipalOrgs: fillBatch("grant_principals", "grant_id, kind, key"),
  fillTaskNeedOrgs: fillBatch("task_needs", "task, needs"),
};

export async function backfillBoardOrgIds(tx: Db, dialect: Dialect, keys: BoardKeys): Promise<boolean> {
  const params = { ...keys, limit: batchSize };
  const principals = await query(tx, dialect, backfillStatements.fillPrincipalOrgs, params);
  const needs = await query(tx, dialect, backfillStatements.fillTaskNeedOrgs, params);
  return principals.length === batchSize || needs.length === batchSize;
}
