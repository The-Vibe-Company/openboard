import { ORG_PURGE_RETENTION_MS } from "@openboard/core";
import { type Job, type JobLease, PURGE_ORG_JOB } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { type Fragment, query, sql } from "../../sql.ts";

const pickLock: Fragment = {
  fragment: ({ name }) => (name === "postgres" ? " FOR UPDATE OF o SKIP LOCKED" : ""),
};
const unqueued: Fragment = {
  fragment: () => `o.deleted_at IS NOT NULL AND o.purged_at IS NULL
  AND EXISTS (SELECT 1 FROM boards b WHERE b.org_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.org_id = o.id AND j.kind = '${PURGE_ORG_JOB}')`,
};

/** Dispatch metadata only, like the ordinary job picker. Old writers leave a tombstone and no job row. */
export const legacyPurgePlatform = {
  nextLegacyPurge: sql`SELECT MIN(o.deleted_at) AS deleted_at FROM orgs o WHERE ${unqueued}`,
  pickLegacyPurge: sql`SELECT o.id, o.deleted_at FROM orgs o
    WHERE o.deleted_at <= ${"through"} AND ${unqueued}
    ORDER BY o.deleted_at, o.id LIMIT 1${pickLock}`,
};

export const legacyPurgeScoped = {
  legacyPurgeBoard: sql`SELECT b.id FROM boards b WHERE b.org_id = ${"orgId"}
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.org_id = ${"orgId"} AND j.kind = ${"kind"})
    ORDER BY b.id LIMIT 1`,
  leaseLegacyPurge: sql`INSERT INTO jobs (org_id, board_id, kind, available_at, instance_id, payload)
    VALUES (${"orgId"}, ${"boardId"}, ${"kind"}, ${"until"}, ${"instanceId"}, ${"payload"})
    RETURNING CAST(id AS TEXT) AS id`,
};

export async function nextLegacyPurge(db: Db, dialect: Dialect) {
  const [row] = await query(db, dialect, legacyPurgePlatform.nextLegacyPurge, {});
  return row?.deleted_at == null ? null : Number(row.deleted_at) + ORG_PURGE_RETENTION_MS;
}

/** Recover deletions written by an old instance only when their original retention has elapsed.
 * The compatible runner creates an already-claimed lease; old runners never enqueue or claim this kind.
 */
export async function claimLegacyPurge(tx: Db, dialect: Dialect, lease: JobLease, until: number): Promise<Job | null> {
  const [org] = await query(tx, dialect, legacyPurgePlatform.pickLegacyPurge, {
    through: lease.claimedAt - ORG_PURGE_RETENTION_MS,
  });
  if (!org) return null;
  const orgId = Number(org.id);
  const kind = PURGE_ORG_JOB;
  // Recheck with a fresh snapshot after the org lock. Another picker may have committed while this one selected.
  const [board] = await query(tx, dialect, legacyPurgeScoped.legacyPurgeBoard, { orgId, kind });
  if (!board) return null;
  const boardId = Number(board.id);
  const [job] = await query(tx, dialect, legacyPurgeScoped.leaseLegacyPurge, {
    orgId,
    boardId,
    kind,
    until,
    instanceId: lease.instanceId,
    payload: JSON.stringify({ deletedAt: Number(org.deleted_at) }),
  });
  if (!job) throw new Error("legacy purge lease did not return an ID");
  return { id: String(job.id), orgId, boardId, kind };
}
