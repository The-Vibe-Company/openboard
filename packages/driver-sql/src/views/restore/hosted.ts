import { BoardError } from "@openboard/contract";
import type { BackupBoard, BackupMembership } from "@openboard/ports";
import { type Db, postgresText } from "../../db.ts";
import { PROJECTION_VERSION } from "../../projection-version.ts";
import { forUpdate, query, sql } from "../../sql.ts";
import { shippingStatements } from "../jobs/shipping.ts";
import { setOrgDeletion } from "../operator/org-deletion.ts";
import { orgStatements } from "../orgs.ts";

export const restorePlatform = {
  restoreOrgBySlug: sql`SELECT id FROM orgs WHERE slug = ${"slug"}`,
  restoreOrgById: sql`SELECT id, slug, purged_at FROM orgs WHERE id = ${"orgId"}${forUpdate}`,
  restoreInsertOrg: sql`INSERT INTO orgs (id, slug, name, created_by, created_at) OVERRIDING SYSTEM VALUE
    VALUES (${"orgId"}, ${"slug"}, ${"name"}, ${"userId"}, ${"at"})`,
  restorePerson: sql`SELECT id FROM users WHERE public_id = ${"personId"}`,
  restoreOrgSequence: sql`SELECT setval(pg_get_serial_sequence('orgs', 'id'),
    GREATEST((SELECT MAX(id) FROM orgs), (SELECT last_value FROM orgs_id_seq)))`,
  restoreBoardSequence: sql`SELECT setval(pg_get_serial_sequence('boards', 'id'),
    GREATEST((SELECT MAX(id) FROM boards), (SELECT last_value FROM boards_id_seq)))`,
  restoreOrgDeletion: sql`UPDATE orgs SET deleted_at = ${"at"} WHERE id = ${"orgId"}`,
};

export const hostedRestoreStatements = {
  restoreBoards: sql`SELECT id, slug, name, head, created_at, deleted_at FROM boards WHERE org_id = ${"orgId"}`,
  restoreInsertBoard: sql`INSERT INTO boards (id, org_id, slug, name, created_at, deleted_at, projection) OVERRIDING SYSTEM VALUE
    VALUES (${"boardId"}, ${"orgId"}, ${"slug"}, ${"name"}, ${"createdAt"}, ${"deletedAt"}, ${"projection"})`,
  restoreBoardDeletion: sql`UPDATE boards SET deleted_at = ${"deletedAt"}
    WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
  restoreLegacyBoardRows: sql`SELECT 1 FROM grant_principals WHERE board_id = ${"boardId"} AND org_id IS NULL
    UNION ALL SELECT 1 FROM task_needs WHERE board_id = ${"boardId"} AND org_id IS NULL LIMIT 1`,
  restoreOrgHead: sql`SELECT COALESCE(MAX(id), 0) AS head FROM org_events WHERE org_id = ${"orgId"}`,
  restoreMember: sql`INSERT INTO memberships (org_id, user_id, role, created_at)
    VALUES (${"orgId"}, ${"userId"}, ${"role"}, ${"at"})
    ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role`,
  restoreMemberInviter: sql`UPDATE memberships SET invited_by = ${"inviter"}
    WHERE org_id = ${"orgId"} AND user_id = ${"userId"} AND created_at = ${"createdAt"} AND invited_by IS NULL`,
  restoreRemoveMember: sql`DELETE FROM memberships WHERE org_id = ${"orgId"} AND user_id = ${"userId"}`,
};

export interface RestoreOrgEvent {
  id: number;
  type: string;
  at: number;
  actor: string;
  payload: Record<string, unknown>;
}

const s = hostedRestoreStatements;
const p = restorePlatform;
const run = <K extends string>(tx: Db, stmt: Parameters<typeof query<K>>[2], params: Parameters<typeof query<K>>[3]) =>
  query(tx, postgresText, stmt, params);

async function person(tx: Db, principal: unknown) {
  if (typeof principal !== "string" || !principal.startsWith("ob:user:")) return;
  const [user] = await run(tx, p.restorePerson, { personId: principal.slice(8) });
  if (user) return Number(user.id);
}

export async function restoreNewOrg(tx: Db, orgId: number, event: RestoreOrgEvent | undefined) {
  const org = event?.payload.org as { slug?: unknown; name?: unknown } | undefined;
  if (
    event?.id !== 1 ||
    event.type !== "ob.org.created" ||
    typeof org?.slug !== "string" ||
    typeof org.name !== "string"
  )
    throw new BoardError("invalid_request", `Missing creation event for organization ${orgId}`);
  const userId = (await person(tx, event.payload.owner)) ?? 0;
  await run(tx, p.restoreInsertOrg, { orgId, slug: org.slug, name: org.name, userId, at: event.at });
  return org.slug;
}

export async function restoreBoardRows(tx: Db, orgId: number, manifest: readonly BackupBoard[] | undefined) {
  const existing = await run(tx, s.restoreBoards, { orgId });
  const heads = new Map(existing.map((row) => [Number(row.id), Number(row.head)]));
  for (const board of manifest ?? []) {
    const row = existing.find(({ id }) => Number(id) === board.id);
    const keys = { orgId, boardId: board.id };
    if (row && row.slug !== board.slug)
      throw new BoardError("invalid_request", `Backup board mapping disagrees with database for board ${board.id}`);
    if (!row) {
      await run(tx, s.restoreInsertBoard, { ...keys, ...board, projection: PROJECTION_VERSION });
      heads.set(board.id, 0);
    }
  }
  return heads;
}

export async function restoreOrgEvents(tx: Db, orgId: number, events: readonly RestoreOrgEvent[]) {
  for (const { id, type, at, actor, payload } of events) {
    await run(tx, orgStatements.insertOrgEvent, { orgId, id, type, at, actor, payload: JSON.stringify(payload) });
    if (type === "ob.org.deleted" || type === "ob.operator.deleted" || type === "ob.operator.undeleted") {
      await run(tx, p.restoreOrgDeletion, { orgId, at: type === "ob.operator.undeleted" ? null : at });
    }
    if (
      type !== "ob.org.created" &&
      type !== "ob.member.added" &&
      type !== "ob.member.role_changed" &&
      type !== "ob.member.removed"
    )
      continue;
    const userId = await person(tx, type === "ob.org.created" ? payload.owner : payload.principal);
    if (userId === undefined) continue; // Account rows come from the dump.
    if (type === "ob.member.removed") await run(tx, s.restoreRemoveMember, { orgId, userId });
    else {
      const role = type === "ob.org.created" ? "owner" : payload.role;
      if (role !== "owner" && role !== "admin" && role !== "member")
        throw new BoardError("invalid_request", `Invalid membership role in organization event ${id}`);
      await run(tx, s.restoreMember, { orgId, userId, role, at });
    }
  }
  const last = events.at(-1)?.id;
  if (last !== undefined)
    await run(tx, shippingStatements.shippingReserve, { orgId, boardId: 0, shipped: last, pending: last, deadline: 0 });
}

export async function restoreInviters(tx: Db, orgId: number, members: readonly BackupMembership[]) {
  for (const { principal, invitedBy, createdAt } of members) {
    const userId = await person(tx, principal);
    const inviter = await person(tx, invitedBy);
    if (userId !== undefined && inviter !== undefined)
      await run(tx, s.restoreMemberInviter, { orgId, userId, inviter, createdAt });
  }
}

export async function finishSingleOrgRestore(tx: Db, orgId: number) {
  await setOrgDeletion(tx, postgresText, orgId, null, () => {});
}
