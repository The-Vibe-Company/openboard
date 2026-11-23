import { BoardError, type InvitationRole, type Role } from "@openboard/contract";
import type { OrgScope, OrgView, PlatformView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { forUpdate, query, sql } from "../sql.ts";
import { orgStatements } from "./orgs.ts";

export const invitationStatements = {
  orgMembership: sql`SELECT m.org_id, m.role FROM memberships m
    JOIN orgs o ON o.id = m.org_id JOIN users u ON u.id = m.user_id
    WHERE o.slug = ${"slug"} AND u.public_id = ${"personId"} AND o.deleted_at IS NULL AND u.disabled_at IS NULL`,
  lockInvitationOrg: sql`SELECT m.user_id, m.role FROM orgs o
    JOIN memberships m ON m.org_id = o.id JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${"orgId"} AND u.public_id = ${"personId"} AND o.deleted_at IS NULL AND u.disabled_at IS NULL
    AND m.role IN ('admin', 'owner')${forUpdate}`,
  insertInvitation: sql`INSERT INTO invitations (id, org_id, token_hash, email, role, created_by, created_at, expires_at)
    VALUES (${"id"}, ${"orgId"}, ${"tokenHash"}, ${"email"}, ${"role"}, ${"userId"}, ${"at"}, ${"expiresAt"})`,
  nextInvitationEvent: sql`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM org_events WHERE org_id = ${"orgId"}`,
  listOrgMembers: sql`SELECT u.public_id, m.role FROM memberships m
    JOIN users u ON u.id = m.user_id WHERE m.org_id = ${"orgId"} ORDER BY u.public_id`,
  lockRedeemableInvitation: sql`SELECT i.role, o.slug, o.name FROM invitations i
    JOIN orgs o ON o.id = i.org_id WHERE i.org_id = ${"orgId"} AND i.token_hash = ${"tokenHash"}
    AND o.deleted_at IS NULL AND i.accepted_at IS NULL AND i.revoked_at IS NULL
    AND i.expires_at > ${"at"} AND i.email IS NULL${forUpdate}`,
  insertInvitedMember: sql`INSERT INTO memberships (org_id, user_id, role, created_at, invited_by)
    SELECT ${"orgId"}, u.id, i.role, ${"at"}, i.created_by FROM invitations i
    JOIN users u ON u.public_id = ${"personId"}
    WHERE i.org_id = ${"orgId"} AND i.token_hash = ${"tokenHash"} AND u.disabled_at IS NULL
    ON CONFLICT (org_id, user_id) DO NOTHING RETURNING user_id`,
  markInvitationAccepted: sql`UPDATE invitations SET accepted_by = ${"userId"}, accepted_at = ${"at"}
    WHERE org_id = ${"orgId"} AND token_hash = ${"tokenHash"}`,
  invitationByHash: sql`SELECT i.org_id, o.name AS org_name, i.role, i.expires_at, i.accepted_at, i.revoked_at FROM invitations i
    JOIN orgs o ON o.id = i.org_id WHERE i.token_hash = ${"tokenHash"} AND o.deleted_at IS NULL`,
};

/** The tenant resolver's membership lookup and the public preview's proof of possession. */
export function invitationPlatform(
  db: Db,
  dialect: Dialect,
): Pick<PlatformView, "orgMembership" | "invitationPreview" | "acceptInvitation"> {
  return {
    async orgMembership(slug, personId) {
      const [row] = await query(db, dialect, invitationStatements.orgMembership, { slug, personId });
      return row ? { orgId: Number(row.org_id), role: String(row.role) as Role } : null;
    },
    acceptInvitation: (tokenHash, personId, at) =>
      db.transaction(async (tx) => {
        const [found] = await query(tx, dialect, invitationStatements.invitationByHash, { tokenHash });
        if (!found) return null;
        const orgId = Number(found.org_id);
        const scope = { orgId, tokenHash, at };
        const [invitation] = await query(tx, dialect, invitationStatements.lockRedeemableInvitation, scope);
        if (!invitation) return null;
        await query(tx, dialect, orgStatements.lockPerson, { personId });
        const [joined] = await query(tx, dialect, orgStatements.personMemberships, { personId });
        if (joined) throw new BoardError("already_in_org", "you already belong to an organization");
        const [member] = await query(tx, dialect, invitationStatements.insertInvitedMember, { ...scope, personId });
        if (!member) return null;
        const userId = Number(member.user_id);
        const role = String(invitation.role) as InvitationRole;
        await query(tx, dialect, invitationStatements.markInvitationAccepted, { ...scope, userId });
        const [next] = await query(tx, dialect, invitationStatements.nextInvitationEvent, { orgId });
        const principal = `ob:user:${personId}`;
        await query(tx, dialect, orgStatements.insertOrgEvent, {
          orgId,
          id: Number(next?.id),
          type: "ob.member.added",
          at,
          actor: principal,
          payload: JSON.stringify({ principal, role }),
        });
        return { org: { slug: String(invitation.slug), name: String(invitation.name) }, role };
      }),
    async invitationPreview(tokenHash) {
      const [row] = await query(db, dialect, invitationStatements.invitationByHash, { tokenHash });
      return row
        ? {
            orgName: String(row.org_name),
            role: String(row.role) as InvitationRole,
            expiresAt: Number(row.expires_at),
            used: row.accepted_at !== null || row.revoked_at !== null,
          }
        : null;
    },
  };
}

export function invitationView(
  db: Db,
  dialect: Dialect,
  { orgId }: OrgScope,
): Pick<OrgView, "createInvitation" | "listMembers"> {
  return {
    async listMembers() {
      const rows = await query(db, dialect, invitationStatements.listOrgMembers, { orgId });
      return rows.map((row) => ({ principal: `ob:user:${row.public_id}`, role: String(row.role) as Role }));
    },
    createInvitation: (record) =>
      db.transaction(async (tx) => {
        const { invitation, tokenHash, personId, at } = record;
        const [org] = await query(tx, dialect, invitationStatements.lockInvitationOrg, { orgId, personId });
        if (!org) return false;
        await query(tx, dialect, invitationStatements.insertInvitation, {
          ...invitation,
          orgId,
          tokenHash,
          email: invitation.email ?? null,
          userId: Number(org.user_id),
          at,
          expiresAt: record.expiresAt,
        });
        const [next] = await query(tx, dialect, invitationStatements.nextInvitationEvent, { orgId });
        await query(tx, dialect, orgStatements.insertOrgEvent, {
          orgId,
          id: Number(next?.id),
          type: "ob.invitation.created",
          at,
          actor: invitation.createdBy,
          payload: JSON.stringify({ id: invitation.id, role: invitation.role }),
        });
        return true;
      }),
  };
}
