import { BoardError, type Role } from "@openboard/contract";
import { type CountQuota, type CountQuotas, countQuotas } from "@openboard/core";
import type { BoardMemberRecord, BoardScope, BoardView, CreateOrgRecord, PlatformView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { forUpdate, query, sql } from "../sql.ts";

/** Organizations, their memberships and their events. */
export const orgStatements = {
  setOrgQuotas: sql`UPDATE orgs SET quotas = ${"quotas"} WHERE id = ${"orgId"} RETURNING id`,
  lockPerson: sql`SELECT id, email FROM users WHERE public_id = ${"personId"}${forUpdate}`,
  insertOrg: sql`INSERT INTO orgs (slug, name, created_by, created_at)
    VALUES (${"slug"}, ${"name"}, ${"userId"}, ${"at"}) ON CONFLICT (slug) DO NOTHING RETURNING id`,
  insertMembership: sql`INSERT INTO memberships (org_id, user_id, role, created_at)
    VALUES (${"orgId"}, ${"userId"}, ${"role"}, ${"at"})`,
  insertBoard: sql`INSERT INTO boards (org_id, slug, name, created_at) VALUES (${"orgId"}, ${"slug"}, ${"name"}, ${"at"})`,
  insertOrgEvent: sql`INSERT INTO org_events (org_id, id, type, at, actor, payload)
    VALUES (${"orgId"}, ${"id"}, ${"type"}, ${"at"}, ${"actor"}, ${"payload"})`,
  personMemberships: sql`SELECT o.slug, o.name, m.role FROM memberships m
    JOIN users u ON u.id = m.user_id JOIN orgs o ON o.id = m.org_id
    WHERE u.public_id = ${"personId"} AND o.deleted_at IS NULL ORDER BY o.slug`,
  boardMember: sql`SELECT m.role, o.slug AS org_slug, o.name AS org_name, b.slug AS board_slug, b.name AS board_name
    FROM memberships m JOIN users u ON u.id = m.user_id JOIN orgs o ON o.id = m.org_id
    JOIN boards b ON b.org_id = m.org_id
    WHERE m.org_id = ${"orgId"} AND b.id = ${"boardId"} AND u.public_id = ${"personId"} AND u.disabled_at IS NULL`,
};

/** Platform statements for account operations and operator quota overrides. */
export const orgPlatformStatements: readonly (keyof typeof orgStatements)[] = Object.freeze([
  "lockPerson",
  "setOrgQuotas",
  "insertOrg",
  "personMemberships",
]);

const role = (row: Row) => String(row.role) as Role;

async function lockPerson(tx: Db, dialect: Dialect, personId: string): Promise<number> {
  const [user] = await query(tx, dialect, orgStatements.lockPerson, { personId });
  if (!user) throw new Error(`person ${personId} creates an organization but does not exist`);
  return Number(user.id);
}

/** Count and compare after acquiring the resource's write lock. */
export function exhaustedQuota(reason: CountQuota, stored: unknown, count: unknown) {
  const overrides = typeof stored === "string" ? (JSON.parse(stored) as Partial<CountQuotas> | null) : null;
  const limit = countQuotas(overrides ?? {})[reason];
  return Number(count) >= limit ? { quota: limit } : null;
}

/** The platform's organization methods, written once for both engines. */
export function orgView(db: Db, dialect: Dialect): Pick<PlatformView, "createOrg" | "memberships" | "setOrgQuotas"> {
  return {
    createOrg: (record: CreateOrgRecord) =>
      db.transaction(async (tx) => {
        const at = record.now;
        const userId = await lockPerson(tx, dialect, record.personId);
        const [membership] = await query(tx, dialect, orgStatements.personMemberships, { personId: record.personId });
        if (membership) throw new BoardError("already_in_org", "you already belong to an organization");
        const [org] = await query(tx, dialect, orgStatements.insertOrg, { ...record.org, userId, at });
        if (!org) {
          throw new BoardError("slug_taken", "this organization slug is already in use", {
            hint: "Choose a different organization slug.",
          });
        }
        const orgId = Number(org.id);
        await query(tx, dialect, orgStatements.insertMembership, { orgId, userId, role: record.role, at });
        await query(tx, dialect, orgStatements.insertBoard, { orgId, ...record.board, at });
        for (const event of record.events) {
          const { id, type, actor } = event;
          const payload = JSON.stringify(event.payload);
          await query(tx, dialect, orgStatements.insertOrgEvent, { orgId, id, type, at: event.at, actor, payload });
        }
      }),
    async setOrgQuotas(orgId, overrides) {
      const [org] = await query(db, dialect, orgStatements.setOrgQuotas, { orgId, quotas: JSON.stringify(overrides) });
      return org !== undefined;
    },
    async memberships(personId) {
      const rows = await query(db, dialect, orgStatements.personMemberships, { personId });
      return rows.map((row) => ({ org: { slug: String(row.slug), name: String(row.name) }, role: role(row) }));
    },
  };
}

/** A board's view of who belongs to its organization. */
export function orgReads(
  db: Db,
  dialect: Dialect,
  scope: Pick<BoardScope, "orgId" | "boardId">,
): Pick<BoardView, "member"> {
  return {
    async member(personId): Promise<BoardMemberRecord | null> {
      const { orgId, boardId } = scope;
      const [row] = await query(db, dialect, orgStatements.boardMember, { orgId, boardId, personId });
      if (!row) return null;
      return {
        role: role(row),
        org: { slug: String(row.org_slug), name: String(row.org_name) },
        board: { slug: String(row.board_slug), name: String(row.board_name) },
      };
    },
  };
}
