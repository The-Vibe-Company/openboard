import { BoardError, type InvitationRole, type Role } from "@openboard/contract";
import type { OrgScope, OrgView, PlatformView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { forUpdate, query, sql } from "../sql.ts";
import { exhaustedQuota, orgStatements } from "./orgs.ts";

export const invitationStatements = {
  orgMembership: sql`SELECT m.org_id, m.role FROM memberships m
    JOIN orgs o ON o.id = m.org_id JOIN users u ON u.id = m.user_id
    WHERE o.slug = ${"slug"} AND u.public_id = ${"personId"} AND o.deleted_at IS NULL AND u.disabled_at IS NULL`,
  lockInvitationOrg: sql`SELECT m.user_id, m.role, o.quotas FROM orgs o
    JOIN memberships m ON m.org_id = o.id JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${"orgId"} AND u.public_id = ${"personId"} AND o.deleted_at IS NULL AND u.disabled_at IS NULL
    AND m.role IN ('admin', 'owner')${forUpdate}`,
  insertInvitation: sql`INSERT INTO invitations (id, org_id, token_hash, email, role, created_by, created_at, expires_at)
    VALUES (${"id"}, ${"orgId"}, ${"tokenHash"}, ${"email"}, ${"role"}, ${"userId"}, ${"at"}, ${"expiresAt"})`,
  nextInvitationEvent: sql`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM org_events WHERE org_id = ${"orgId"}`,
  listOrgMembers: sql`SELECT u.public_id, m.role FROM memberships m
    JOIN users u ON u.id = m.user_id WHERE m.org_id = ${"orgId"} ORDER BY u.public_id`,
  lockRedeemableInvitation: sql`SELECT i.role, i.email, o.slug, o.name, o.quotas FROM invitations i
    JOIN orgs o ON o.id = i.org_id WHERE i.org_id = ${"orgId"} AND i.token_hash = ${"tokenHash"}
    AND o.deleted_at IS NULL AND i.accepted_at IS NULL AND i.revoked_at IS NULL
    AND i.expires_at > ${"at"}${forUpdate}`,
  orgMemberCount: sql`SELECT COUNT(*) AS count FROM memberships WHERE org_id = ${"orgId"}`,
  insertInvitedMember: sql`INSERT INTO memberships (org_id, user_id, role, created_at, invited_by)
    SELECT ${"orgId"}, u.id, i.role, ${"at"}, i.created_by FROM invitations i
    JOIN users u ON u.public_id = ${"personId"}
    WHERE i.org_id = ${"orgId"} AND i.token_hash = ${"tokenHash"} AND u.disabled_at IS NULL
    ON CONFLICT (org_id, user_id) DO NOTHING RETURNING user_id`,
  markInvitationAccepted: sql`UPDATE invitations SET accepted_by = ${"userId"}, accepted_at = ${"at"}
    WHERE org_id = ${"orgId"} AND token_hash = ${"tokenHash"}`,
  lockOrgInvitation: sql`SELECT accepted_at, revoked_at FROM invitations
    WHERE org_id = ${"orgId"} AND id = ${"id"}${forUpdate}`,
  markInvitationRevoked: sql`UPDATE invitations SET revoked_at = ${"at"} WHERE org_id = ${"orgId"} AND id = ${"id"}`,
  invitationByHash: sql`SELECT i.org_id, o.name AS org_name, i.role, i.expires_at, i.accepted_at, i.revoked_at FROM invitations i
    JOIN orgs o ON o.id = i.org_id WHERE i.token_hash = ${"tokenHash"} AND o.deleted_at IS NULL`,
};

/** Redeem inside the caller's transaction so sign-up and acceptance can commit together. */
export async function redeemInvitation(tx: Db, dialect: Dialect, tokenHash: Uint8Array, personId: string, at: number) {
  const [found] = await query(tx, dialect, invitationStatements.invitationByHash, { tokenHash });
  if (!found) return null;
  const orgId = Number(found.org_id);
  const scope = { orgId, tokenHash, at };
  const [invitation] = await query(tx, dialect, invitationStatements.lockRedeemableInvitation, scope);
  if (!invitation) {
    // Read again after the lock wait, so an accept or revoke that committed meanwhile is seen.
    const [latest] = await query(tx, dialect, invitationStatements.invitationByHash, { tokenHash });
    if (latest && (latest.accepted_at !== null || latest.revoked_at !== null || Number(latest.expires_at) <= at))
      throw new BoardError("invitation_used", "this invitation was already used, revoked or expired");
    return null;
  }
  const [person] = await query(tx, dialect, orgStatements.lockPerson, { personId });
  if (!person) return null;
  if (
    typeof invitation.email === "string" &&
    (typeof person.email !== "string" || person.email.toLowerCase() !== invitation.email)
  ) {
    throw new BoardError("invitation_email_mismatch", "this invitation requires a matching verified email");
  }
  const [joined] = await query(tx, dialect, orgStatements.personMemberships, { personId });
  if (joined) throw new BoardError("already_in_org", "you already belong to an organization");
  const [usage] = await query(tx, dialect, invitationStatements.orgMemberCount, { orgId });
  const quota = exhaustedQuota("members", invitation.quotas, usage?.count);
  if (quota) return quota;
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
}

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
      db.transaction((tx) => redeemInvitation(tx, dialect, tokenHash, personId, at)),
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
): Pick<OrgView, "createInvitation" | "listMembers" | "revokeInvitation"> {
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
        record.admit?.();
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
    revokeInvitation: (id, personId, at, admit) =>
      db.transaction(async (tx) => {
        // The invitation row is locked before the organization's, in the same order as accepting it.
        const [invitation] = await query(tx, dialect, invitationStatements.lockOrgInvitation, { orgId, id });
        const [admin] = await query(tx, dialect, invitationStatements.lockInvitationOrg, { orgId, personId });
        if (!admin) return "not_admin";
        admit?.();
        if (!invitation) return "not_found";
        if (invitation.accepted_at !== null || invitation.revoked_at !== null) return "used";
        await query(tx, dialect, invitationStatements.markInvitationRevoked, { orgId, id, at });
        const [next] = await query(tx, dialect, invitationStatements.nextInvitationEvent, { orgId });
        await query(tx, dialect, orgStatements.insertOrgEvent, {
          orgId,
          id: Number(next?.id),
          type: "ob.invitation.revoked",
          at,
          actor: `ob:user:${personId}`,
          payload: JSON.stringify({ id }),
        });
        return "revoked";
      }),
  };
}
