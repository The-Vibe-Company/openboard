import type { BoardKeys, PlatformView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { forUpdate, query, sql } from "../sql.ts";

/** Statements on organizations and boards themselves. `orgBySlug` runs before any tenant is known. */
export const boardStatements = {
  orgBySlug: sql`SELECT id FROM orgs WHERE slug = ${"slug"} AND deleted_at IS NULL`,
  boardBySlug: sql`SELECT id FROM boards WHERE org_id = ${"orgId"} AND slug = ${"slug"} AND deleted_at IS NULL`,
  lockBoard: sql`SELECT head FROM boards WHERE org_id = ${"orgId"} AND id = ${"boardId"}${forUpdate}`,
  setHead: sql`UPDATE boards SET head = ${"head"} WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
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

/** Reads the board's head under its lock: the first statement of every board write (docs/data-model.md). */
export async function lockBoard(tx: Db, dialect: Dialect, keys: BoardKeys): Promise<number> {
  const [row] = await query(tx, dialect, boardStatements.lockBoard, keys);
  if (!row) throw new Error(`board ${keys.boardId} of organization ${keys.orgId} is missing`);
  return Number(row.head);
}

export async function setHead(tx: Db, dialect: Dialect, keys: BoardKeys, head: number): Promise<void> {
  await query(tx, dialect, boardStatements.setHead, { ...keys, head });
}
