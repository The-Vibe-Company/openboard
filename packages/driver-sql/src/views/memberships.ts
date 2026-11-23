import { BoardError, type Role } from "@openboard/contract";
import { decideMemberRole, requireAnotherOwner } from "@openboard/core";
import type { OrgScope, OrgView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { query, sql } from "../sql.ts";
import { invitationStatements } from "./invitations.ts";
import { orgStatements } from "./orgs.ts";

export const membershipStatements = {
  targetMember: sql`SELECT m.user_id, m.role FROM memberships m
    JOIN users u ON u.id = m.user_id WHERE m.org_id = ${"orgId"} AND u.public_id = ${"targetId"}`,
  anotherOwner: sql`SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${"orgId"} AND m.user_id <> ${"userId"} AND m.role = 'owner' AND u.disabled_at IS NULL LIMIT 1`,
  updateMemberRole: sql`UPDATE memberships SET role = ${"role"}
    WHERE org_id = ${"orgId"} AND user_id = ${"userId"}`,
};

export function membershipView(db: Db, dialect: Dialect, { orgId }: OrgScope): Pick<OrgView, "changeMemberRole"> {
  return {
    changeMemberRole: ({ personId, targetId, role, at }) =>
      db.transaction(async (tx) => {
        const [actor] = await query(tx, dialect, invitationStatements.lockInvitationOrg, { orgId, personId });
        if (!actor) throw new BoardError("forbidden", "this organization needs an administrator");
        // The organization lock serializes membership writes without locking the target user across organizations.
        const [target] = await query(tx, dialect, membershipStatements.targetMember, { orgId, targetId });
        if (!target) return null;

        const principal = `ob:user:${targetId}`;
        const previousRole = String(target.role) as Role;
        if (decideMemberRole(String(actor.role) as Role, previousRole, role)) {
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
  };
}
