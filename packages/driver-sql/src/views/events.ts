import type { Message } from "@openboard/contract";
import {
  type ActorSeen,
  type ChannelCreated,
  channelFilter,
  type EventFilters,
  type LabelsChanged,
  type MessageDeleted,
  type MessageEdited,
  type MessagePosted,
  matchesEventChannel,
  matchesEventMessage,
  messages,
  type TaskEvent,
} from "@openboard/core";
import type { BoardScope, BoardView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { type Fragment, query, sql } from "../sql.ts";

const NEWEST_LOOKBACK = 2000;

const feedTypes: Fragment = {
  fragment: () => "('message.posted', 'message.edited', 'message.deleted', 'labels.changed', 'task.created')",
};

/** Bookkeeping: events that concern no message, served only with `all` (docs/data-model.md, `visibility` 1). */
const bookkeepingTypes: Fragment = { fragment: () => "('actor.seen', 'channel.created')" };

function eventPage(newest: boolean) {
  const projectedView: Fragment = { fragment: () => (newest ? ", m.view AS current" : ", NULL AS current") };
  const joins: Fragment = {
    fragment: () =>
      newest ? "LEFT JOIN messages m ON m.org_id = e.org_id AND m.board_id = e.board_id AND m.id = e.message" : "",
  };
  const direction: Fragment = { fragment: () => (newest ? "DESC" : "ASC") };
  const newestOnly: Fragment = { fragment: () => (newest ? "1" : "0") };
  const start: Fragment = { fragment: () => (newest ? `b.head - ${NEWEST_LOOKBACK}` : "b.head") };
  return sql`SELECT b.head, e.id, e.type, e.at, e.thread, e.message, e.channel, e.actor, e.principal,
    e.visibility, e.payload,
    CASE WHEN ${"history"} = 1 AND e.visibility = 0 AND e.type IN ('message.edited', 'message.deleted', 'labels.changed', 'task.created') THEN (
      SELECT p.payload FROM events p
      WHERE p.org_id = ${"orgId"} AND p.board_id = ${"boardId"} AND p.thread = e.thread
        AND p.message = e.message AND p.id < e.id AND p.visibility = 0
        AND p.type IN ('message.posted', 'message.edited', 'message.deleted', 'labels.changed', 'task.created')
      ORDER BY p.id DESC LIMIT 1
    ) END AS previous,
    CASE WHEN ${"rootLabels"} = 1 AND e.message <> e.thread AND e.visibility = 0
      AND e.type IN ('message.posted', 'message.edited', 'message.deleted', 'labels.changed', 'task.created') THEN (
      SELECT p.payload FROM events p
      WHERE p.org_id = ${"orgId"} AND p.board_id = ${"boardId"} AND p.thread = e.thread
        AND p.message = e.thread AND p.id < e.id AND p.visibility = 0
        AND p.type IN ('message.posted', 'message.edited', 'message.deleted', 'labels.changed', 'task.created')
      ORDER BY p.id DESC LIMIT 1
    ) END AS root${projectedView}
    FROM boards b LEFT JOIN events e ON e.org_id = b.org_id AND e.board_id = b.id
      AND e.id > COALESCE(${"after"}, ${start}) AND e.id <= b.head
      AND (${newestOnly} = 0 OR (
        ((e.visibility = 0 AND e.type IN ${feedTypes})
          OR (${"all"} = 1 AND e.visibility = 1 AND e.type IN ${bookkeepingTypes}))
        AND (CAST(${"channel"} AS TEXT) IS NULL OR e.channel = ${"channel"} OR e.channel LIKE ${"under"} ESCAPE '\\')
        AND (CAST(${"thread"} AS BIGINT) IS NULL OR e.thread = ${"thread"})
      ))
    ${joins}
    WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"}
    ORDER BY e.id ${direction} LIMIT ${"limit"}`;
}

export const eventStatements = {
  readEvents: eventPage(false),
  newestEvents: eventPage(true),
};

type FeedEvent = MessagePosted | MessageEdited | MessageDeleted | LabelsChanged | TaskEvent;

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
  if (row.type === "task.created") return { ...common, type: "task.created", payload: payload as TaskEvent["payload"] };
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

function bookkeepingEvent(row: Row): ActorSeen | ChannelCreated {
  const common = {
    id: Number(row.id),
    at: Number(row.at),
    thread: null,
    message: null,
    actor: String(row.actor),
    principal: String(row.principal),
    visibility: 1 as const,
  };
  const payload = JSON.parse(String(row.payload)) as unknown;
  return row.type === "actor.seen"
    ? { ...common, type: "actor.seen", channel: null, payload: payload as ActorSeen["payload"] }
    : {
        ...common,
        type: "channel.created",
        channel: String(row.channel),
        payload: payload as ChannelCreated["payload"],
      };
}

function filteredEvent(
  row: Row,
  filters: EventFilters,
  all: boolean,
): ((FeedEvent & { current?: Message }) | ActorSeen | ChannelCreated)[] {
  if (all && Number(row.visibility) === 1 && (row.type === "actor.seen" || row.type === "channel.created"))
    return [bookkeepingEvent(row)];
  if (
    Number(row.visibility) !== 0 ||
    (row.type !== "message.posted" &&
      row.type !== "message.edited" &&
      row.type !== "message.deleted" &&
      row.type !== "labels.changed" &&
      row.type !== "task.created") ||
    !matchesEventChannel(String(row.channel), filters.channel)
  )
    return [];
  const event = messageEvent(row);
  const current = event.type === "message.posted" ? messages.messageView(event) : event.payload.view;
  const root = snapshot(row.root);
  const previous = snapshot(row.previous);
  if (
    !matchesEventMessage(current, root, filters) &&
    !(previous !== undefined && matchesEventMessage(previous, root, filters))
  )
    return [];
  if (typeof row.current !== "string") return [event];
  return [{ ...event, current: JSON.parse(row.current) as Message }];
}

export function eventReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "readEvents"> {
  return {
    async readEvents(after, filters = {}) {
      const { last } = filters;
      const selected = filters.channel === undefined ? undefined : channelFilter(filters.channel);
      // Bookkeeping concerns no message, so any filter leaves it out (upstream `03-http.md`, "Event types").
      const all =
        filters.all === true &&
        [
          filters.channel,
          filters.thread,
          filters.labels?.length ? filters.labels : undefined,
          filters.text,
          filters.from,
          filters.authors,
          filters.mentions,
        ].every((value) => value === undefined);
      const history = filters.text !== undefined || filters.mentions !== undefined || Boolean(filters.labels?.length);
      // Like upstream's local feed, bound the lookback when filtering historical payloads.
      const limit =
        last === undefined
          ? 200
          : history || filters.from !== undefined || filters.authors !== undefined
            ? NEWEST_LOOKBACK
            : last;
      const rows = await query(
        db,
        dialect,
        last === undefined ? eventStatements.readEvents : eventStatements.newestEvents,
        {
          orgId: scope.orgId,
          boardId: scope.boardId,
          after: last === undefined ? (after ?? null) : null,
          channel: selected?.channel ?? null,
          under: selected?.under ?? null,
          thread: filters.thread ?? null,
          limit,
          history: history ? 1 : 0,
          rootLabels: filters.labels?.length ? 1 : 0,
          all: all ? 1 : 0,
        },
      );
      const first = rows[0];
      if (!first) throw new Error("the scoped board is missing");
      const head = Number(first.head);
      const cursor = Number(rows.at(-1)?.id ?? head);
      const events = rows.flatMap((row) => filteredEvent(row, filters, all));
      if (last === undefined) return { head, cursor, events };
      return { head, cursor: head, events: events.slice(0, last).reverse() };
    },
  };
}
