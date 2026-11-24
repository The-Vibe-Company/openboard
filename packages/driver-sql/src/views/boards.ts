import type { Named } from "@openboard/contract";
import type { BoardCreation } from "@openboard/core";
import type { BoardKeys, OrgScope, OrgView, PlatformView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { forUpdate, type Fragment, query, sql } from "../sql.ts";
import { invitationStatements } from "./invitations.ts";
import { orgStatements } from "./orgs.ts";

const notifyHead: Fragment = Object.freeze({ fragment: (dialect: Dialect) => dialect.notifyHeadSuffix });
const serverTimeline: Fragment = Object.freeze({ fragment: (dialect: Dialect) => dialect.serverTimeline });

/** How far a write moves the head past a timeline change, above any cursor handed out before it (D37). */
export const TIMELINE_ADVANCE = 1_000_000;

/** Statements on organizations and boards themselves. `orgBySlug` runs before any tenant is known. */
export const boardStatements = {
  orgBySlug: sql`SELECT id FROM orgs WHERE slug = ${"slug"} AND deleted_at IS NULL`,
  boardBySlug: sql`SELECT id FROM boards WHERE org_id = ${"orgId"} AND slug = ${"slug"} AND deleted_at IS NULL`,
  lockBoard: sql`SELECT head, timeline, ${serverTimeline} AS server_timeline FROM boards
    WHERE org_id = ${"orgId"} AND id = ${"boardId"}${forUpdate}`,
  setHead: sql`UPDATE boards SET head = ${"head"}, timeline = ${serverTimeline}
    WHERE org_id = ${"orgId"} AND id = ${"boardId"}${notifyHead}`,
  orgBoards: sql`SELECT slug, name FROM boards WHERE org_id = ${"orgId"} AND deleted_at IS NULL ORDER BY slug`,
  boardSlugUsed: sql`SELECT id FROM boards WHERE org_id = ${"orgId"} AND slug = ${"slug"}`,
};

/** Statements that run outside any tenant: resolving the organization a path names. */
export const boardPlatformStatements: readonly (keyof typeof boardStatements)[] = ["orgBySlug"];

export function platformView(db: Db, dialect: Dialect): Pick<PlatformView, "findBoard"> {
  return {
    async findBoard(orgSlug, boardSlug): Promise<BoardKeys | null> {
      const [org] = await query(db, dialect, boardStatements.orgBySlug, { slug: orgSlug });
      if (!org) return null;
      const orgId = Number(org.id);
      const [board] = await query(db, dialect, boardStatements.boardBySlug, { orgId, slug: boardSlug });
      return board ? { orgId, boardId: Number(board.id) } : null;
    },
  };
}

/**
 * Reads the board's head under its lock: the first statement of every board write (docs/data-model.md). The same
 * statement reads the server's timeline; when it differs from the one the board recorded, the write allocates from
 * `TIMELINE_ADVANCE` above the head, so IDs lost in a failover are never reused (D37). `setHead` records the timeline
 * with the new head, so a write that appends nothing changes nothing. A board that recorded no timeline yet (`0`)
 * does not advance, and an engine whose timeline is the constant `0` (SQLite) never does.
 */
export async function lockBoard(tx: Db, dialect: Dialect, keys: BoardKeys): Promise<number> {
  const [row] = await query(tx, dialect, boardStatements.lockBoard, keys);
  if (!row) throw new Error(`board ${keys.boardId} of organization ${keys.orgId} is missing`);
  const head = Number(row.head);
  const recorded = Number(row.timeline ?? 0);
  const timeline = Number(row.server_timeline ?? 0);
  return timeline === 0 || recorded === 0 || timeline === recorded ? head : head + TIMELINE_ADVANCE;
}

/** Moves the board's head to its last appended event and records the server's timeline with it (D37). */
export async function setHead(tx: Db, dialect: Dialect, keys: BoardKeys, head: number): Promise<void> {
  await query(tx, dialect, boardStatements.setHead, { ...keys, head });
}

/** One organization's boards, every statement bound to its scope. */
export function orgBoardsView(
  db: Db,
  dialect: Dialect,
  { orgId }: OrgScope,
): Pick<OrgView, "listBoards" | "createBoard"> {
  return {
    async listBoards(): Promise<Named[]> {
      const rows = await query(db, dialect, boardStatements.orgBoards, { orgId });
      return rows.map((row) => ({ slug: String(row.slug), name: String(row.name) }));
    },
    createBoard: ({ board, event }: BoardCreation, personId: string) =>
      db.transaction(async (tx) => {
        // The organization's row and the creator's admin membership, locked as every organization write locks them.
        const [admin] = await query(tx, dialect, invitationStatements.lockInvitationOrg, { orgId, personId });
        if (!admin) return "not_admin" as const;
        const [used] = await query(tx, dialect, boardStatements.boardSlugUsed, { orgId, slug: board.slug });
        if (used) return "slug_taken" as const;
        await query(tx, dialect, orgStatements.insertBoard, { orgId, ...board, at: event.at });
        const [next] = await query(tx, dialect, invitationStatements.nextInvitationEvent, { orgId });
        const { type, at, actor } = event;
        const payload = JSON.stringify(event.payload);
        await query(tx, dialect, orgStatements.insertOrgEvent, {
          orgId,
          id: Number(next?.id),
          type,
          at,
          actor,
          payload,
        });
        return "created" as const;
      }),
  };
}
