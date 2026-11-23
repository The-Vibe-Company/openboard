import type { InvitationRole, Role } from "@openboard/contract";
import type { OrgScope, OrgView, PlatformView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { forUpdate, query, sql } from "../sql.ts";
import { orgStatements } from "./orgs.ts";

export const invitationStatements = {
  orgMembership: sql`SELECT m.org_id, m.role FROM memberships m
    JOIN orgs o ON o.id = m.org_id JOIN users u ON u.id = m.user_id
    WHERE o.slug = ${"slug"} AND u.public_id = ${"personId"} AND o.deleted_at IS NULL AND u.disabled_at IS NULL`,
  lockInvitationOrg: sql`SELECT m.user_id FROM orgs o
    JOIN memberships m ON m.org_id = o.id JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${"orgId"} AND u.public_id = ${"personId"} AND o.deleted_at IS NULL AND u.disabled_at IS NULL
    AND m.role IN ('admin', 'owner')${forUpdate}`,
  insertInvitation: sql`INSERT INTO invitations (id, org_id, token_hash, email, role, created_by, created_at, expires_at)
    VALUES (${"id"}, ${"orgId"}, ${"tokenHash"}, ${"email"}, ${"role"}, ${"userId"}, ${"at"}, ${"expiresAt"})`,
  nextInvitationEvent: sql`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM org_events WHERE org_id = ${"orgId"}`,
  invitationByHash: sql`SELECT o.name AS org_name, i.role, i.expires_at, i.accepted_at, i.revoked_at FROM invitations i
    JOIN orgs o ON o.id = i.org_id WHERE i.token_hash = ${"tokenHash"} AND o.deleted_at IS NULL`,
};

/** The tenant resolver's membership lookup and the public preview's proof of possession. */
export function invitationPlatform(
  db: Db,
  dialect: Dialect,
): Pick<PlatformView, "orgMembership" | "invitationPreview"> {
  return {
    async orgMembership(slug, personId) {
      const [row] = await query(db, dialect, invitationStatements.orgMembership, { slug, personId });
      return row ? { orgId: Number(row.org_id), role: String(row.role) as Role } : null;
    },
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

export function invitationView(db: Db, dialect: Dialect, { orgId }: OrgScope): Pick<OrgView, "createInvitation"> {
  return {
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
