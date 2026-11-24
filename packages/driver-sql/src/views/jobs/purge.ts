import { ORG_PURGE_RETENTION_MS } from "@openboard/core";
import type { OrgScope, OrgView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { type Fragment, forUpdate, query, type Statement, sql } from "../../sql.ts";
import { type JobWrites, jobWriter, readLeasedJob } from "./index.ts";

const batchSize = 1000;
type BatchParam = "orgId" | "boardId" | "batchSize";

// Interpolated fragments are fixed schema identifiers. Both query levels bind the tenant.
function deleteBatch(table: string, key: string, scope: "org" | "board" | "both") {
  const fragment = (value: string): Fragment => ({ fragment: () => value });
  const from = fragment(table);
  const keys = fragment(key);
  if (scope === "both") {
    return sql<BatchParam>`DELETE FROM ${from} WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}
      AND (${keys}) IN (SELECT ${keys} FROM ${from} WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}
        ORDER BY ${keys} LIMIT ${"batchSize"}) RETURNING 1`;
  }
  const column = fragment(scope === "org" ? "org_id" : "board_id");
  const tenant = scope === "org" ? "orgId" : "boardId";
  return sql<BatchParam>`DELETE FROM ${from} WHERE ${column} = ${tenant}
    AND (${keys}) IN (SELECT ${keys} FROM ${from} WHERE ${column} = ${tenant}
      ORDER BY ${keys} LIMIT ${"batchSize"}) RETURNING 1`;
}

function deletes(tables: Readonly<Record<string, string>>, scope: "org" | "both") {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(tables).map(([table, key]) => [`purge_${table}`, deleteBatch(table, key, scope)]),
    ),
  );
}

const orgDeletes = deletes(
  {
    device_codes: "device_hash",
    invitations: "id",
    jobs: "id",
    memberships: "org_id, user_id",
    org_events: "org_id, id",
    org_export_audit: "org_id, id",
    org_exports: "org_id, id",
    personal_tokens: "id",
    shipping: "org_id, board_id",
    tenant_rate_counters: "key, window_start",
  },
  "org",
);

const boardDeletes = {
  ...deletes(
    {
      actors: "board_id, id",
      channels: "board_id, path",
      connection_agents: "id",
      connections: "id",
      events: "board_id, id",
      grants: "board_id, id",
      messages: "board_id, id",
      schemas: "board_id, id",
      tasks: "board_id, id",
      watcher_matches: "board_id, id",
      webhook_deliveries: "id",
      webhook_secrets: "id",
      webhooks: "id",
      inbound_secrets: "id",
      inbound_endpoints: "id",
      watcher_registrations: "board_id, owner",
    },
    "both",
  ),
  purge_grant_principals: deleteBatch("grant_principals", "board_id, grant_id, kind, key", "board"),
  purge_task_needs: deleteBatch("task_needs", "board_id, task, needs", "board"),
};

const lockOrg: Fragment = { fragment: ({ name }) => (name === "postgres" ? " FOR UPDATE OF o" : "") };

export const purgeStatements = {
  ...orgDeletes,
  ...boardDeletes,
  purge_lock_org: sql`SELECT o.deleted_at FROM orgs o JOIN boards b ON b.org_id = o.id
    WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"}${lockOrg}`,
  purge_lock_boards: sql`SELECT id FROM boards WHERE org_id = ${"orgId"} ORDER BY id${forUpdate}`,
  purge_check_exports: sql`SELECT 1 FROM org_exports WHERE org_id = ${"orgId"} LIMIT 1`,
  purge_check_shipping: sql`SELECT 1 FROM shipping WHERE org_id = ${"orgId"} LIMIT 1`,
  purge_boards: deleteBatch("boards", "id", "org"),
  markPurgeStarted: sql`UPDATE jobs SET payload = ${"payload"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  markPurgeComplete: sql`UPDATE orgs SET purged_at = ${"now"} FROM boards b
    WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"} AND orgs.id = b.org_id`,
};

async function removeBatches(
  tx: Db,
  dialect: Dialect,
  statements: readonly Statement<BatchParam>[],
  orgId: number,
  boardId: number | null,
) {
  for (const statement of statements) {
    while ((await query(tx, dialect, statement, { orgId, boardId, batchSize })).length === batchSize) {
      // Continue until the batch is short.
    }
  }
}

async function removeRows(tx: Db, dialect: Dialect, orgId: number, boards: readonly Row[]) {
  const boardStatements = Object.values(boardDeletes);
  for (const { id } of boards) {
    await removeBatches(tx, dialect, boardStatements, orgId, Number(id));
  }
  // Boards come last, after their jobs and dependent rows.
  await removeBatches(tx, dialect, [...Object.values(orgDeletes), purgeStatements.purge_boards], orgId, null);
}

export function purgeOrgView(
  db: Db,
  dialect: Dialect,
  { orgId }: OrgScope,
  jobs: JobWrites,
): Pick<OrgView, "purgeOrg"> {
  return {
    async purgeOrg(boardId, id, lease, now, deleteBackup) {
      const keys = { orgId, boardId };
      if (deleteBackup) {
        const eligible = await db.transaction(async (tx) => {
          const [org] = await query(tx, dialect, purgeStatements.purge_lock_org, keys);
          if (org?.deleted_at == null || Number(org.deleted_at) + ORG_PURGE_RETENTION_MS > now) return false;
          const payload = await readLeasedJob(tx, dialect, keys, id, lease, now);
          if (payload?.deletedAt !== Number(org.deleted_at)) return false;
          // Persist the fence before touching external storage. A released lease must not allow restoration.
          await query(tx, dialect, purgeStatements.markPurgeStarted, {
            ...keys,
            id,
            payload: JSON.stringify({ ...payload, purgeStarted: true }),
          });
          return true;
        });
        if (!eligible) return false;
        // The archived organization is fenced against new uploads before this job is due.
        await deleteBackup();
      }
      return db.transaction(async (tx) => {
        const [org] = await query(tx, dialect, purgeStatements.purge_lock_org, keys);
        if (!org) return false;
        // Wait for writes that began before the soft delete before removing their rows.
        const boards = await query(tx, dialect, purgeStatements.purge_lock_boards, keys);
        const writer = jobWriter(tx, dialect, keys, () => {});
        const finishedAt = deleteBackup ? jobs.now() : now;
        const payload = await writer.takeJob(id, lease, finishedAt);
        if (!payload || org.deleted_at == null || Number(org.deleted_at) !== payload.deletedAt) return false;
        if (!deleteBackup) {
          const shipped = await query(tx, dialect, purgeStatements.purge_check_shipping, keys);
          const exports = await query(tx, dialect, purgeStatements.purge_check_exports, keys);
          if (shipped.length || exports.length) throw new Error("Backup bucket required to purge backups");
        }
        await query(tx, dialect, purgeStatements.markPurgeComplete, { ...keys, now: finishedAt });
        await removeRows(tx, dialect, orgId, boards);
        return true;
      });
    },
  };
}
