import { BoardError, type Role } from "@openboard/contract";
import {
  decideMemberRole,
  ORG_PURGE_RETENTION_MS,
  orgDeletion,
  requireAnotherOwner,
  requireMemberRemoval,
  requireOrgOwner,
} from "@openboard/core";
import { type OrgScope, type OrgView, PURGE_ORG_JOB } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { forUpdate, query, sql } from "../sql.ts";
import { invitationStatements } from "./invitations.ts";
import { type JobWrites, jobWriter } from "./jobs/index.ts";
import { orgStatements } from "./orgs.ts";

export const membershipStatements = {
  lockRemovingMember: sql`SELECT m.user_id, m.role FROM orgs o
    JOIN memberships m ON m.org_id = o.id JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${"orgId"} AND u.public_id = ${"personId"} AND o.deleted_at IS NULL AND u.disabled_at IS NULL${forUpdate}`,
  markOrgDeleted: sql`UPDATE orgs SET deleted_at = ${"at"} FROM memberships m
    WHERE orgs.id = m.org_id AND m.org_id = ${"orgId"} AND m.user_id = ${"userId"}
    AND orgs.deleted_at IS NULL RETURNING slug, name`,
  purgeJobBoard: sql`SELECT id FROM boards WHERE org_id = ${"orgId"} ORDER BY id LIMIT 1`,
  deleteMember: sql`DELETE FROM memberships WHERE org_id = ${"orgId"} AND user_id = ${"userId"}`,
  targetMember: sql`SELECT m.user_id, m.role FROM memberships m
    JOIN users u ON u.id = m.user_id WHERE m.org_id = ${"orgId"} AND u.public_id = ${"targetId"}`,
  anotherOwner: sql`SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${"orgId"} AND m.user_id <> ${"userId"} AND m.role = 'owner' AND u.disabled_at IS NULL LIMIT 1`,
  updateMemberRole: sql`UPDATE memberships SET role = ${"role"}
    WHERE org_id = ${"orgId"} AND user_id = ${"userId"}`,
};

async function deleteOrg(
  db: Db,
  dialect: Dialect,
  jobs: JobWrites,
  orgId: number,
  personId: string,
  at: number,
  admit?: () => void,
) {
  const deleted = await db.transaction(async (tx) => {
    const [actor] = await query(tx, dialect, membershipStatements.lockRemovingMember, { orgId, personId });
    if (!actor) throw new BoardError("not_found", "no such organization");
    requireOrgOwner(String(actor.role) as Role);
    admit?.();
    const [org] = await query(tx, dialect, membershipStatements.markOrgDeleted, {
      orgId,
      at,
      userId: Number(actor.user_id),
    });
    if (!org) throw new Error("locked organization disappeared");
    const deleted = orgDeletion({ slug: String(org.slug), name: String(org.name) }, at);
    const [next] = await query(tx, dialect, invitationStatements.nextInvitationEvent, { orgId });
    await query(tx, dialect, orgStatements.insertOrgEvent, {
      orgId,
      id: Number(next?.id),
      type: "ob.org.deleted",
      at,
      actor: `ob:user:${personId}`,
      payload: JSON.stringify(deleted),
    });
    const [board] = await query(tx, dialect, membershipStatements.purgeJobBoard, { orgId });
    if (!board) throw new Error("organization has no board to route its purge job");
    const writer = jobWriter(tx, dialect, { orgId, boardId: Number(board.id) }, jobs, () => {});
    await writer.enqueue(PURGE_ORG_JOB, at + ORG_PURGE_RETENTION_MS, { deletedAt: at });
    return deleted;
  });
  jobs.committed();
  return deleted;
}

export function membershipView(
  db: Db,
  dialect: Dialect,
  { orgId }: OrgScope,
  jobs: JobWrites,
): Pick<OrgView, "changeMemberRole" | "removeMember" | "deleteOrg"> {
  return {
    deleteOrg: (personId, at, admit) => deleteOrg(db, dialect, jobs, orgId, personId, at, admit),
    changeMemberRole: ({ personId, targetId, role, at, admit }) =>
      db.transaction(async (tx) => {
        const [actor] = await query(tx, dialect, invitationStatements.lockInvitationOrg, { orgId, personId });
        if (!actor) throw new BoardError("forbidden", "this organization needs an administrator");
        // The organization lock serializes membership writes without locking the target user across organizations.
        const [target] = await query(tx, dialect, membershipStatements.targetMember, { orgId, targetId });
        if (!target) return null;

        const principal = `ob:user:${targetId}`;
        const previousRole = String(target.role) as Role;
        const changed = decideMemberRole(String(actor.role) as Role, previousRole, role);
        admit?.();
        if (changed) {
          const userId = Number(target.user_id);
          if (previousRole === "owner") {
            const [other] = await query(tx, dialect, membershipStatements.anotherOwner, { orgId, userId });
            requireAnotherOwner(other !== undefined);
          }
          await query(tx, dialect, membershipStatements.updateMemberRole, {
            orgId,
            userId,
            role,
          });
          const [next] = await query(tx, dialect, invitationStatements.nextInvitationEvent, { orgId });
          await query(tx, dialect, orgStatements.insertOrgEvent, {
            orgId,
            id: Number(next?.id),
            type: "ob.member.role_changed",
            at,
            actor: `ob:user:${personId}`,
            payload: JSON.stringify({ principal, previousRole, role }),
          });
        }
        return { principal, role };
      }),
    removeMember: ({ personId, targetId, at, admit }) =>
      db.transaction(async (tx) => {
        const [actor] = await query(tx, dialect, membershipStatements.lockRemovingMember, { orgId, personId });
        if (!actor) throw new BoardError("not_found", "no such organization");
        const [target] = await query(tx, dialect, membershipStatements.targetMember, { orgId, targetId });
        if (!target) return null;

        const role = String(target.role) as Role;
        requireMemberRemoval(String(actor.role) as Role, role, personId === targetId);
        admit?.();
        const userId = Number(target.user_id);
        if (role === "owner") {
          const [other] = await query(tx, dialect, membershipStatements.anotherOwner, { orgId, userId });
          requireAnotherOwner(other !== undefined);
        }
        const principal = `ob:user:${targetId}`;
        await query(tx, dialect, membershipStatements.deleteMember, { orgId, userId });
        const [next] = await query(tx, dialect, invitationStatements.nextInvitationEvent, { orgId });
        await query(tx, dialect, orgStatements.insertOrgEvent, {
          orgId,
          id: Number(next?.id),
          type: "ob.member.removed",
          at,
          actor: `ob:user:${personId}`,
          payload: JSON.stringify({ principal, role }),
        });
        return { principal };
      }),
  };
}
