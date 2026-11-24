import { BoardError, type DeletedBoard, type Named } from "@openboard/contract";
import {
  type BoardCreation,
  boards,
  dailyEventsLimit,
  isoTime,
  type OrgQuotaOverrides,
  storedBytesLimit,
} from "@openboard/core";
import type { BoardKeys, Broadcaster, OrgScope, OrgView, PlatformView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { type Fragment, query, sql } from "../sql.ts";
import { invitationStatements } from "./invitations.ts";
import { exhaustedQuota, orgStatements } from "./orgs.ts";

const notifyHead: Fragment = Object.freeze({ fragment: (dialect: Dialect) => dialect.notifyHeadSuffix });
// Lock the organization before the board, in the same order as board deletion.
const boardLock: Fragment = Object.freeze({
  fragment: (dialect: Dialect) => (dialect.lockSuffix ? ` FOR SHARE OF orgs${dialect.lockSuffix} OF boards` : ""),
});
const notifyDeletion: Fragment = Object.freeze({
  fragment: ({ name }: Dialect) =>
    name === "postgres" ? ", (SELECT pg_notify('ob_events', boards.id::text || ':deleted'))" : "",
});
const messageBytes: Fragment = Object.freeze({
  fragment: ({ name }: Dialect) =>
    name === "postgres"
      ? "octet_length(convert_to(m.text, 'UTF8')) + COALESCE(octet_length(convert_to(CAST(CAST(m.view AS JSON) -> 'blocks' AS TEXT), 'UTF8')), 0)"
      : "octet_length(m.text) + COALESCE(octet_length(m.view -> 'blocks'), 0)",
});
const skipLocked: Fragment = Object.freeze({
  fragment: ({ name }: Dialect) => (name === "postgres" ? " FOR UPDATE SKIP LOCKED" : ""),
});
const serverTimeline: Fragment = Object.freeze({ fragment: (dialect: Dialect) => dialect.serverTimeline });

// Keep the count and the head it covers together. An older writer only advances boards.head.
const eventTally: Fragment = Object.freeze({
  fragment: ({ name }: Dialect) =>
    name === "postgres" ? "CAST(boards.daily_event_tally AS JSON)" : "boards.daily_event_tally",
});
const eventDay: Fragment = Object.freeze({
  fragment: () =>
    "CASE WHEN boards.daily_event_day > quota_clock.day THEN boards.daily_event_day ELSE quota_clock.day END",
});

/** How far a write moves the head past a timeline change, above any cursor handed out before it (D37). */
export const TIMELINE_ADVANCE = 1_000_000;

/** Statements on organizations and boards themselves. `orgBySlug` runs before any tenant is known. */
export const boardStatements = {
  orgBySlug: sql`SELECT id FROM orgs WHERE slug = ${"slug"} AND deleted_at IS NULL`,
  boardBySlug: sql`SELECT id, deleted_at FROM boards WHERE org_id = ${"orgId"} AND slug = ${"slug"}`,
  softDeleteBoard: sql`UPDATE boards SET deleted_at = ${"at"}
    WHERE org_id = ${"orgId"} AND slug = ${"slug"} AND deleted_at IS NULL RETURNING id, name${notifyDeletion}`,
  lockBoard: sql`SELECT boards.head, boards.timeline, ${serverTimeline} AS server_timeline, orgs.quotas, orgs.deleted_at, boards.deleted_at AS board_deleted_at,
    ${eventDay} AS event_day,
    EXISTS (SELECT 1 FROM watcher_registrations w WHERE w.org_id = ${"orgId"} AND w.board_id = ${"boardId"} AND w.watch <> '{}') AS has_watchers,
    CASE WHEN boards.daily_event_day >= quota_clock.day THEN CAST(${eventTally} ->> 'count' AS BIGINT)
      ELSE 0 END +
    CASE WHEN boards.head = 0 OR CAST(${eventTally} ->> 'head' AS BIGINT) = boards.head THEN 0 ELSE (
      SELECT COUNT(*) FROM events e WHERE e.org_id = ${"orgId"} AND e.board_id = ${"boardId"}
        AND e.at >= (${eventDay}) AND e.at < (${eventDay}) + (quota_clock.next_day - quota_clock.day)
        AND e.id > COALESCE(CAST(${eventTally} ->> 'head' AS BIGINT), 0)
    ) END AS event_count,
    actors.id, actors.kind, actors.handle, actors.name, actors.avatar, actors.via,
    target.view, tasks.claim_token, tasks.claim_until,
    CASE WHEN boards.stored_bytes_head = boards.head THEN boards.stored_bytes ELSE (
      SELECT COALESCE(SUM(${messageBytes}), 0)
      FROM messages m WHERE m.org_id = ${"orgId"} AND m.board_id = ${"boardId"} AND m.deleted = 0
    ) END AS board_bytes,
    (SELECT snapshot.head FROM boards snapshot
      WHERE snapshot.org_id = ${"orgId"} AND snapshot.id = ${"boardId"}) AS snapshot_head,
    EXISTS(SELECT 1 FROM boards sibling WHERE sibling.org_id = ${"orgId"} AND sibling.id <> ${"boardId"}
      AND COALESCE(sibling.stored_bytes_head, -1) <> sibling.head) AS stale_siblings,
    (SELECT COALESCE(SUM(CASE WHEN sibling.stored_bytes_head = sibling.head THEN sibling.stored_bytes ELSE (
      SELECT COALESCE(SUM(${messageBytes}), 0)
      FROM messages m WHERE m.org_id = ${"orgId"} AND m.board_id = sibling.id AND m.deleted = 0
    ) END), 0) FROM boards sibling WHERE sibling.org_id = ${"orgId"} AND sibling.id <> ${"boardId"}) AS other_bytes
    FROM orgs JOIN boards ON boards.org_id = orgs.id
    CROSS JOIN (SELECT CAST(${"day"} AS BIGINT) AS day, CAST(${"nextDay"} AS BIGINT) AS next_day) quota_clock
    LEFT JOIN actors ON actors.org_id = boards.org_id AND actors.board_id = boards.id AND actors.id = ${"actor"}
    LEFT JOIN messages target ON target.org_id = boards.org_id AND target.board_id = boards.id AND target.id = ${"taskId"}
    LEFT JOIN tasks ON tasks.org_id = target.org_id AND tasks.board_id = target.board_id AND tasks.id = target.id
    WHERE boards.org_id = ${"orgId"} AND boards.id = ${"boardId"}${boardLock}`,
  setHead: sql`UPDATE boards SET head = ${"head"}, timeline = ${serverTimeline},
    stored_bytes = ${"storedBytes"}, stored_bytes_head = ${"head"},
    daily_event_day = ${"eventDay"}, daily_event_tally = ${"eventTally"}
    WHERE org_id = ${"orgId"} AND id = ${"boardId"}${notifyHead}`,
  repairStoredBytes: sql`WITH stale AS (
    SELECT id, head, org_id FROM boards
    WHERE org_id = ${"orgId"} AND id <> ${"boardId"} AND COALESCE(stored_bytes_head, -1) <> head
      AND head = (SELECT snapshot.head FROM boards snapshot WHERE snapshot.org_id = ${"orgId"}
        AND snapshot.id = boards.id)${skipLocked}
  )
    UPDATE boards SET stored_bytes = (
      SELECT COALESCE(SUM(${messageBytes}), 0) FROM messages m
      WHERE m.org_id = ${"orgId"} AND m.board_id = stale.id AND m.deleted = 0
    ), stored_bytes_head = stale.head
    FROM stale WHERE boards.org_id = ${"orgId"} AND boards.id = stale.id`,
  orgBoards: sql`SELECT slug, name FROM boards WHERE org_id = ${"orgId"} AND deleted_at IS NULL ORDER BY slug`,
  orgBoardCount: sql`SELECT COUNT(*) AS count FROM boards WHERE org_id = ${"orgId"} AND deleted_at IS NULL`,
  boardSlugUsed: sql`SELECT id FROM boards WHERE org_id = ${"orgId"} AND slug = ${"slug"}`,
};

/** Statements that run outside any tenant: resolving the organization a path names. */
export const boardPlatformStatements: readonly (keyof typeof boardStatements)[] = ["orgBySlug"];

export function platformView(db: Db, dialect: Dialect): Pick<PlatformView, "findBoard"> {
  return {
    async findBoard(orgSlug, boardSlug, includeDeleted) {
      const [org] = await query(db, dialect, boardStatements.orgBySlug, { slug: orgSlug });
      if (!org) return null;
      const orgId = Number(org.id);
      const [board] = await query(db, dialect, boardStatements.boardBySlug, { orgId, slug: boardSlug });
      if (!board || (board.deleted_at != null && !includeDeleted)) return null;
      const keys = { orgId, boardId: Number(board.id) };
      return board.deleted_at == null ? keys : { ...keys, deleted: true };
    },
  };
}

export interface BoardStorage {
  readonly boardBytes: number;
  readonly otherBytes: number;
  readonly limit: number;
  readonly staleSiblings: boolean;
}

/**
 * Reads the board's head under its lock: the first statement of every board write (docs/data-model.md). The same
 * statement reads the server's timeline; when it differs from the one the board recorded, the write allocates from
 * `TIMELINE_ADVANCE` above the head, so IDs lost in a failover are never reused (D37). `setHead` records the timeline
 * with the new head, so a write that appends nothing changes nothing. A board that recorded no timeline yet (`0`)
 * does not advance, and an engine whose timeline is the constant `0` (SQLite) never does.
 */
export async function lockBoard(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  actor: string | null,
  window: { readonly day: number; readonly nextDay: number },
  taskId: number | null,
) {
  const params = { ...keys, ...window, taskId };
  let actorLoaded = dialect.name === "sqlite" || taskId !== null;
  let [row] = await query(tx, dialect, boardStatements.lockBoard, { ...params, actor: actorLoaded ? actor : null });
  // A waiting Postgres statement refreshes only the locked row. If another writer advanced it, get a
  // fresh snapshot of sibling usage, the legacy own-board fallback, the actor and the task target together.
  if (row?.snapshot_head != null && Number(row.snapshot_head) !== Number(row.head)) {
    [row] = await query(tx, dialect, boardStatements.lockBoard, { ...params, actor });
    actorLoaded = true;
  }
  if (!row) throw new Error(`board ${keys.boardId} of organization ${keys.orgId} is missing`);
  if (row.deleted_at != null || row.board_deleted_at != null)
    throw new BoardError("not_found", "no such board or route");
  const head = Number(row.head);
  const recorded = Number(row.timeline ?? 0);
  const timeline = Number(row.server_timeline ?? 0);
  const overrides = typeof row.quotas === "string" ? (JSON.parse(row.quotas) as OrgQuotaOverrides | null) : null;
  return {
    row,
    actorLoaded,
    hasWatchers: Boolean(row.has_watchers),
    head: timeline === 0 || recorded === 0 || timeline === recorded ? head : head + TIMELINE_ADVANCE,
    dailyEvents: {
      day: Number(row.event_day),
      count: Number(row.event_count),
      limit: dailyEventsLimit(overrides ?? {}),
    },
    storage: {
      boardBytes: Number(row.board_bytes),
      otherBytes: Number(row.other_bytes),
      limit: storedBytesLimit(overrides ?? {}),
      staleSiblings: Boolean(row.stale_siblings),
    },
  };
}

/** Moves the board's head and records its folded size and the server's timeline (D37). */
export async function setHead(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  head: number,
  storedBytes: number,
  dailyEvents: { readonly day: number; readonly count: number },
) {
  await query(tx, dialect, boardStatements.setHead, {
    ...keys,
    head,
    storedBytes,
    eventDay: dailyEvents.day,
    eventTally: JSON.stringify({ head, count: dailyEvents.count }),
  });
}

/** Initialize untouched legacy siblings when a write can repair them without waiting for their locks. */
export async function repairStoredBytes(tx: Db, dialect: Dialect, keys: BoardKeys) {
  await query(tx, dialect, boardStatements.repairStoredBytes, keys);
}

/** One organization's boards, every statement bound to its scope. */
export function orgBoardsView(
  db: Db,
  dialect: Dialect,
  { orgId }: OrgScope,
  broadcaster: Broadcaster,
): Pick<OrgView, "listBoards" | "createBoard" | "deleteBoard"> {
  return {
    async listBoards(): Promise<Named[]> {
      const rows = await query(db, dialect, boardStatements.orgBoards, { orgId });
      return rows.map((row) => ({ slug: String(row.slug), name: String(row.name) }));
    },
    async deleteBoard(slug, personId, at, admit) {
      const { boardId, result } = await deleteBoard(db, dialect, { orgId, slug, personId, at }, admit);
      if (dialect.name === "sqlite") broadcaster.invalidate({ orgId, boardId });
      return result;
    },
    createBoard: ({ board, event }: BoardCreation, personId: string, admit?: () => void) =>
      db.transaction(async (tx) => {
        // The organization's row and the creator's admin membership, locked as every organization write locks them.
        const [admin] = await query(tx, dialect, invitationStatements.lockInvitationOrg, { orgId, personId });
        if (!admin) return "not_admin" as const;
        admit?.();
        const [used] = await query(tx, dialect, boardStatements.boardSlugUsed, { orgId, slug: board.slug });
        if (used) return "slug_taken" as const;
        const [usage] = await query(tx, dialect, boardStatements.orgBoardCount, { orgId });
        const quota = exhaustedQuota("boards", admin.quotas, usage?.count);
        if (quota) return quota;
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

/** Serialize deletion with organization audit events and board writers. */
function deleteBoard(
  db: Db,
  dialect: Dialect,
  params: { orgId: number; slug: string; personId: string; at: number },
  admit?: () => void,
): Promise<{ boardId: number; result: DeletedBoard }> {
  return db.transaction(async (tx) => {
    const { orgId, slug, personId, at } = params;
    const [admin] = await query(tx, dialect, invitationStatements.lockInvitationOrg, { orgId, personId });
    if (!admin) throw new BoardError("forbidden", "this organization needs an administrator");
    boards.requireDeletableBoard(slug);
    admit?.();
    const [row] = await query(tx, dialect, boardStatements.softDeleteBoard, { orgId, slug, at });
    if (!row) throw new BoardError("not_found", "no such board or route");
    const result = { board: { slug, name: String(row.name) }, deletedAt: isoTime(at) };
    const [next] = await query(tx, dialect, invitationStatements.nextInvitationEvent, { orgId });
    await query(tx, dialect, orgStatements.insertOrgEvent, {
      orgId,
      id: Number(next?.id),
      type: "ob.board.deleted",
      at,
      actor: `ob:user:${personId}`,
      payload: JSON.stringify(result),
    });
    return { boardId: Number(row.id), result };
  });
}
