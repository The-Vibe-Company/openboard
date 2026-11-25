import { BoardError } from "@openboard/contract";
import type { BoardEvent } from "@openboard/core";
import type { BoardKeys, PlatformView } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { PROJECTION_VERSION } from "../../projection-version.ts";
import { type Fragment, query, sql } from "../../sql.ts";
import { boardLock, messageBytes, scheduleBytes } from "../boards.ts";
import { FIRST_ALLOCATED_GRANT } from "../grants.ts";
import { logEvent, shippingStatements } from "../jobs/shipping.ts";
import { foldEvent } from "../messages/fold.ts";

const pageSize = 512;

const foldTables = Object.freeze([
  "actors",
  "channels",
  "connection_agents",
  "connections",
  "grant_principals",
  "grants",
  "inbound_endpoints",
  "messages",
  "schedules",
  "schemas",
  "task_batches",
  "task_needs",
  "tasks",
  "terms",
  "watcher_registrations",
  "webhooks",
]);

function clearFold(name: (typeof foldTables)[number]) {
  const table: Fragment = { fragment: () => name };
  // These two legacy tables may still have rows awaiting the organization backfill.
  if (name === "grant_principals" || name === "task_needs")
    return sql`DELETE FROM ${table} WHERE board_id = ${"boardId"} AND (org_id = ${"orgId"} OR org_id IS NULL)`;
  return sql`DELETE FROM ${table} WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}`;
}

const replayTimeout: Fragment = {
  fragment: ({ name }) => (name === "postgres" ? "set_config('statement_timeout', '0', true)" : "1"),
};

const s = {
  projectionState: sql`SELECT projection FROM boards WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
  lockProjection: sql`SELECT boards.head, boards.projection, boards.imported_head
    FROM orgs JOIN boards ON boards.org_id = orgs.id
    WHERE boards.org_id = ${"orgId"} AND boards.id = ${"boardId"}
      AND boards.deleted_at IS NULL AND orgs.deleted_at IS NULL${boardLock}`,
  removeReplayStatementTimeout: sql`SELECT ${replayTimeout}`,
  markImportedHead: sql`UPDATE boards SET imported_head = head WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
  beginProjection: sql`UPDATE boards SET projection = -1, next_schedule = 1, next_grant = ${"nextGrant"}
    WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
  resetAttached: sql`UPDATE attachments SET attached = 0
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND attached <> 0`,
  finishProjection: sql`UPDATE boards SET projection = ${"version"}, stored_bytes_head = head,
    stored_bytes = (SELECT COALESCE(SUM(${messageBytes}), 0) FROM messages m
      WHERE m.org_id = ${"orgId"} AND m.board_id = ${"boardId"} AND m.deleted = 0)
      + (SELECT COALESCE(SUM(${scheduleBytes}), 0) FROM schedules s
        WHERE s.org_id = ${"orgId"} AND s.board_id = ${"boardId"})
    WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
};

const clearFolds = Object.fromEntries(foldTables.map((name) => [`reproject_${name}`, clearFold(name)]));
export const reprojectStatements = { ...s, ...clearFolds };
export const markImportedHead = s.markImportedHead;

export function isImportedFold(event: BoardEvent): boolean {
  return (
    event.type === "actor.seen" ||
    event.type === "channel.created" ||
    event.type === "labels.changed" ||
    event.type === "ob.schema.registered" ||
    event.type.startsWith("message.") ||
    event.type.startsWith("reaction.") ||
    event.type.startsWith("task.")
  );
}

async function replay(tx: Db, dialect: Dialect, keys: BoardKeys, end: number, importedHead: number) {
  let shipped = 0;
  let count = 0;
  while (shipped < end) {
    const page = await query(tx, dialect, shippingStatements.shippingBoardLog, {
      ...keys,
      shipped,
      end,
      limit: pageSize,
    });
    for (const row of page) {
      const event = logEvent(row) as BoardEvent;
      shipped = event.id;
      if (event.id > importedHead || isImportedFold(event)) await foldEvent(tx, dialect, keys, event, true);
    }
    count += page.length;
    if (page.length < pageSize) break;
  }
  return count;
}

export function reprojectView(db: Db, dialect: Dialect): Pick<PlatformView, "reprojectBoard"> {
  return {
    async reprojectBoard(keys, onlyIfStale = false) {
      if (onlyIfStale) {
        const [current] = await query(db, dialect, s.projectionState, keys);
        if (Number(current?.projection) === PROJECTION_VERSION) return null;
      }
      return db.transaction(async (tx) => {
        const acquire = () => query(tx, dialect, s.lockProjection, keys);
        const [locked] = await (tx.measureBoardLock ? tx.measureBoardLock(acquire) : acquire());
        if (!locked) throw new BoardError("not_found", "no such board");
        const version = Number(locked.projection);
        if (version > PROJECTION_VERSION)
          throw new BoardError("invalid_request", "This board uses a newer projection version");
        if (onlyIfStale && version === PROJECTION_VERSION) return null;
        if (dialect.name === "postgres") await query(tx, dialect, s.removeReplayStatementTimeout, {});
        await query(tx, dialect, s.beginProjection, { ...keys, nextGrant: FIRST_ALLOCATED_GRANT });
        for (const statement of Object.values(clearFolds)) await query(tx, dialect, statement, keys);
        await query(tx, dialect, s.resetAttached, keys);
        const events = await replay(tx, dialect, keys, Number(locked.head), Number(locked.imported_head));
        await query(tx, dialect, s.finishProjection, { ...keys, version: PROJECTION_VERSION });
        return { events, projection: PROJECTION_VERSION };
      });
    },
  };
}
