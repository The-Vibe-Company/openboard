import {
  type EventFilters,
  type LabelsChanged,
  type MessageDeleted,
  type MessageEdited,
  type MessagePosted,
  matchesEventChannel,
  matchesEventMessage,
  messages,
} from "@openboard/core";
import type { BoardScope, BoardView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { query, sql } from "../sql.ts";

export const eventStatements = {
  readEvents: sql`SELECT b.head, e.id, e.type, e.at, e.thread, e.message, e.channel, e.actor, e.principal,
    e.visibility, e.payload,
    CASE WHEN ${"history"} = 1 AND e.visibility = 0 AND e.type IN ('message.edited', 'message.deleted', 'labels.changed') THEN (
      SELECT p.payload FROM events p
      WHERE p.org_id = ${"orgId"} AND p.board_id = ${"boardId"} AND p.thread = e.thread
        AND p.message = e.message AND p.id < e.id AND p.visibility = 0
        AND p.type IN ('message.posted', 'message.edited', 'message.deleted', 'labels.changed')
      ORDER BY p.id DESC LIMIT 1
    ) END AS previous,
    CASE WHEN ${"rootLabels"} = 1 AND e.message <> e.thread AND e.visibility = 0
      AND e.type IN ('message.posted', 'message.edited', 'message.deleted', 'labels.changed') THEN (
      SELECT p.payload FROM events p
      WHERE p.org_id = ${"orgId"} AND p.board_id = ${"boardId"} AND p.thread = e.thread
        AND p.message = e.thread AND p.id < e.id AND p.visibility = 0
        AND p.type IN ('message.posted', 'message.edited', 'message.deleted', 'labels.changed')
      ORDER BY p.id DESC LIMIT 1
    ) END AS root
    FROM boards b LEFT JOIN events e ON e.org_id = b.org_id AND e.board_id = b.id
      AND e.id > COALESCE(${"after"}, b.head) AND e.id <= b.head
    WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"}
    ORDER BY e.id ASC LIMIT 200`,
};

type FeedEvent = MessagePosted | MessageEdited | MessageDeleted | LabelsChanged;

function messageEvent(row: Row): FeedEvent {
  const common = {
    id: Number(row.id),
    at: Number(row.at),
    thread: Number(row.thread),
    message: Number(row.message),
    channel: String(row.channel),
    actor: String(row.actor),
    principal: String(row.principal),
    visibility: 0 as const,
  };
  const payload = JSON.parse(String(row.payload)) as unknown;
  if (row.type === "labels.changed")
    return { ...common, type: "labels.changed", payload: payload as LabelsChanged["payload"] };
  if (row.type === "message.deleted")
    return { ...common, type: "message.deleted", payload: payload as MessageDeleted["payload"] };
  return row.type === "message.edited"
    ? { ...common, type: "message.edited", payload: payload as MessageEdited["payload"] }
    : { ...common, type: "message.posted", payload: payload as MessagePosted["payload"] };
}

/** A historical post keeps the filter fields in its payload; later changes store them in their view. */
function snapshot(payload: unknown): Parameters<typeof matchesEventMessage>[0] | undefined {
  if (typeof payload !== "string") return undefined;
  const state = JSON.parse(payload) as Parameters<typeof matchesEventMessage>[0] & {
    view?: Parameters<typeof matchesEventMessage>[0];
  };
  return state.view ?? state;
}

function filteredEvent(row: Row, filters: EventFilters): FeedEvent[] {
  if (
    Number(row.visibility) !== 0 ||
    (row.type !== "message.posted" &&
      row.type !== "message.edited" &&
      row.type !== "message.deleted" &&
      row.type !== "labels.changed") ||
    !matchesEventChannel(String(row.channel), filters.channel)
  )
    return [];
  const event = messageEvent(row);
  const current = event.type === "message.posted" ? messages.messageView(event) : event.payload.view;
  const root = snapshot(row.root);
  const previous = snapshot(row.previous);
  return matchesEventMessage(current, root, filters) ||
    (previous !== undefined && matchesEventMessage(previous, root, filters))
    ? [event]
    : [];
}

export function eventReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "readEvents"> {
  return {
    async readEvents(after, filters = {}) {
      const rows = await query(db, dialect, eventStatements.readEvents, {
        orgId: scope.orgId,
        boardId: scope.boardId,
        after: after ?? null,
        history: filters.text !== undefined || filters.mentions !== undefined || filters.labels?.length ? 1 : 0,
        rootLabels: filters.labels?.length ? 1 : 0,
      });
      const first = rows[0];
      if (!first) throw new Error("the scoped board is missing");
      const head = Number(first.head);
      const cursor = Number(rows.at(-1)?.id ?? head);
      return { head, cursor, events: rows.flatMap((row) => filteredEvent(row, filters)) };
    },
  };
}
