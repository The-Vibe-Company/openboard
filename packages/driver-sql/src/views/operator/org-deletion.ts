import { BoardError } from "@openboard/contract";
import { ORG_PURGE_RETENTION_MS } from "@openboard/core";
import { PURGE_ORG_JOB } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { type Fragment, forUpdate, query, sql } from "../../sql.ts";
import { type JobWrites, jobWriter } from "../jobs/index.ts";

const lockUsers: Fragment = {
  fragment: ({ name }) => (name === "postgres" ? " FOR UPDATE OF u" : ""),
};

export const orgDeletionStatements = {
  purgeJobBoard: sql`SELECT id FROM boards WHERE org_id = ${"orgId"} ORDER BY id LIMIT 1`,
  setOrgDeletedAt: sql`UPDATE orgs SET deleted_at = ${"at"} FROM boards b
    WHERE orgs.id = b.org_id AND b.org_id = ${"orgId"} AND b.id = ${"boardId"} RETURNING orgs.slug, orgs.name`,
  lockOrgPurge: sql`SELECT instance_id, payload FROM jobs WHERE org_id = ${"orgId"} AND kind = ${"kind"}${forUpdate}`,
  lockRestoringMembers: sql`SELECT u.id FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${"orgId"} ORDER BY u.id${lockUsers}`,
  restoringMemberConflict: sql`SELECT 1 FROM memberships m
    JOIN memberships other ON other.user_id = m.user_id AND other.org_id <> m.org_id
    JOIN orgs o ON o.id = other.org_id AND o.deleted_at IS NULL
    WHERE m.org_id = ${"orgId"} LIMIT 1`,
  cancelOrgPurge: sql`DELETE FROM jobs WHERE org_id = ${"orgId"} AND kind = ${"kind"}`,
};

async function cancelPurge(tx: Db, dialect: Dialect, orgId: number) {
  const keys = { orgId, kind: PURGE_ORG_JOB };
  const pending = await query(tx, dialect, orgDeletionStatements.lockOrgPurge, keys);
  for (const job of pending) {
    const { purgeStarted } = JSON.parse(String(job.payload)) as { purgeStarted?: boolean };
    if (job.instance_id != null || purgeStarted) {
      throw new BoardError("invalid_request", "organization purge has started");
    }
  }
  await query(tx, dialect, orgDeletionStatements.cancelOrgPurge, keys);
}

async function prepareRestore(tx: Db, dialect: Dialect, orgId: number) {
  // Creation and invitation redemption serialize on the same person rows.
  await query(tx, dialect, orgDeletionStatements.lockRestoringMembers, { orgId });
  const [conflict] = await query(tx, dialect, orgDeletionStatements.restoringMemberConflict, { orgId });
  if (conflict)
    throw new BoardError("already_in_org", "an organization member already belongs to another organization");
  await cancelPurge(tx, dialect, orgId);
}

/** Change deletion state and its purge job under the caller's organization lock. */
export async function setOrgDeletion(
  tx: Db,
  dialect: Dialect,
  orgId: number,
  at: number | null,
  enqueued: JobWrites["committed"],
) {
  const [board] = await query(tx, dialect, orgDeletionStatements.purgeJobBoard, { orgId });
  if (!board) throw new Error("organization has no board to route its purge job");
  const boardId = Number(board.id);
  if (at === null) await prepareRestore(tx, dialect, orgId);
  const [org] = await query(tx, dialect, orgDeletionStatements.setOrgDeletedAt, { orgId, boardId, at });
  if (!org) throw new Error("locked organization disappeared");
  if (at !== null) {
    const writer = jobWriter(tx, dialect, { orgId, boardId }, enqueued);
    await writer.enqueue(PURGE_ORG_JOB, at + ORG_PURGE_RETENTION_MS, { deletedAt: at });
  }
  return { slug: String(org.slug), name: String(org.name) };
}
