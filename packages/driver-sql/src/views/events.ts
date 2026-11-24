import type { Message } from "@openboard/contract";
import {
  type ActorSeen,
  type ChannelCreated,
  channelFilter,
  type EventFilters,
  formatId,
  isTailMessage,
  type LabelsChanged,
  type MessageDeleted,
  type MessageEdited,
  type MessagePosted,
  matchesEventChannel,
  type matchesEventMessage,
  matchesTailEvent,
  type TaskEvent,
  type WatchFailed,
} from "@openboard/core";
import type { BoardScope, BoardView, CommittedEvents, CommittedPage } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { type Fragment, query, sql } from "../sql.ts";

const NEWEST_LOOKBACK = 2000;
/** Rows one forward feed read scans. */
const FORWARD_LIMIT = 200;

const feedTypes: Fragment = {
  fragment: () =>
    "('message.posted', 'message.edited', 'message.deleted', 'labels.changed', 'task.created', 'task.claimed', 'task.completed', 'task.failed', 'task.expired', 'task.released', 'watch.failed')",
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
    CASE WHEN ${"history"} = 1 AND e.visibility = 0 AND e.type IN ('message.edited', 'message.deleted', 'labels.changed', 'task.created', 'task.claimed', 'task.completed', 'task.failed', 'task.expired', 'task.released') THEN (
      SELECT p.payload FROM events p
      WHERE p.org_id = ${"orgId"} AND p.board_id = ${"boardId"} AND p.thread = e.thread
        AND p.message = e.message AND p.id < e.id AND p.visibility = 0
        AND p.type IN ('message.posted', 'message.edited', 'message.deleted', 'labels.changed', 'task.created', 'task.claimed', 'task.completed', 'task.failed', 'task.expired', 'task.released')
      ORDER BY p.id DESC LIMIT 1
    ) END AS previous,
    CASE WHEN ${"rootLabels"} = 1 AND e.message <> e.thread AND e.visibility = 0
      AND e.type IN ('message.posted', 'message.edited', 'message.deleted', 'labels.changed', 'task.created', 'task.claimed', 'task.completed', 'task.failed', 'task.expired', 'task.released') THEN (
      SELECT p.payload FROM events p
      WHERE p.org_id = ${"orgId"} AND p.board_id = ${"boardId"} AND p.thread = e.thread
        AND p.message = e.thread AND p.id < e.id AND p.visibility = 0
        AND p.type IN ('message.posted', 'message.edited', 'message.deleted', 'labels.changed', 'task.created', 'task.claimed', 'task.completed', 'task.failed', 'task.expired', 'task.released')
      ORDER BY p.id DESC LIMIT 1
    ) END AS root${projectedView}
    FROM boards b LEFT JOIN events e ON e.org_id = b.org_id AND e.board_id = b.id
      AND e.id > COALESCE(${"after"}, ${start}) AND e.id <= b.head
      AND (${newestOnly} = 0 OR (
        ((e.visibility = 0 AND e.type IN ${feedTypes})
          OR (${"all"} = 1 AND e.visibility = 1 AND e.type IN ${bookkeepingTypes})
          OR (${"renewals"} = 1 AND e.visibility = 0 AND e.type = 'task.renewed'))
        AND (CAST(${"channel"} AS TEXT) IS NULL OR e.channel = ${"channel"} OR e.channel LIKE ${"under"} ESCAPE '\\')
        AND (CAST(${"thread"} AS BIGINT) IS NULL OR e.thread = ${"thread"})
        AND (${"watchFailures"} = 1 OR e.type <> 'watch.failed')
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

export function messageEvent(row: Row): FeedEvent {
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
  if (row.type === "task.created")
    return {
      ...common,
      type: "task.created",
      payload: payload as Extract<TaskEvent, { type: "task.created" }>["payload"],
    };
  if (row.type === "task.expired")
    return {
      ...common,
      type: "task.expired",
      payload: payload as Extract<TaskEvent, { type: "task.expired" }>["payload"],
    };
  if (row.type === "task.released")
    return {
      ...common,
      type: "task.released",
      payload: payload as Extract<TaskEvent, { type: "task.released" }>["payload"],
    };
  if (row.type === "task.failed")
    return {
      ...common,
      type: "task.failed",
      payload: payload as Extract<TaskEvent, { type: "task.failed" }>["payload"],
    };
  if (row.type === "task.completed")
    return {
      ...common,
      type: "task.completed",
      payload: payload as Extract<TaskEvent, { type: "task.completed" }>["payload"],
    };
  if (row.type === "task.renewed")
    return {
      ...common,
      type: "task.renewed",
      payload: payload as Extract<TaskEvent, { type: "task.renewed" }>["payload"],
    };
  if (row.type === "task.claimed")
    return {
      ...common,
      type: "task.claimed",
      payload: payload as Extract<TaskEvent, { type: "task.claimed" }>["payload"],
    };
  if (row.type === "labels.changed")
    return { ...common, type: "labels.changed", payload: payload as LabelsChanged["payload"] };
  if (row.type === "message.deleted")
    return { ...common, type: "message.deleted", payload: payload as MessageDeleted["payload"] };
  return row.type === "message.edited"
    ? { ...common, type: "message.edited", payload: payload as MessageEdited["payload"] }
    : { ...common, type: "message.posted", payload: payload as MessagePosted["payload"] };
}

function watchFailedEvent(row: Row): WatchFailed {
  return {
    type: "watch.failed",
    id: Number(row.id),
    at: Number(row.at),
    thread: Number(row.thread),
    message: null,
    channel: String(row.channel),
    actor: String(row.actor),
    principal: String(row.principal),
    visibility: 0,
    payload: JSON.parse(String(row.payload)) as WatchFailed["payload"],
  };
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

type Page = Awaited<ReturnType<BoardView["readEvents"]>>;
type Filters = Parameters<BoardView["readEvents"]>[1];
type Snapshot = Parameters<typeof matchesEventMessage>[0];

/** What one feed entry needs before its payload is parsed: a row, or an event a commit just appended. */
interface Entry {
  readonly type: string;
  readonly visibility: number;
  readonly channel: string | null;
}

/** Keep one entry if the feed serves it: bookkeeping only with `all`, a message event when a version matches. */
function feedEvent(
  entry: Entry,
  event: () => Page["events"][number],
  filters: EventFilters,
  all: boolean,
  renewals: boolean,
  root?: Snapshot,
  previous?: Snapshot,
): Page["events"] {
  if (entry.type === "watch.failed") {
    if (
      filters.labels?.length ||
      filters.text !== undefined ||
      filters.from !== undefined ||
      filters.authors !== undefined ||
      filters.mentions !== undefined ||
      !matchesEventChannel(String(entry.channel), filters.channel)
    )
      return [];
    const failure = event() as WatchFailed;
    return filters.thread === undefined || formatId(failure.thread) === filters.thread ? [failure] : [];
  }
  if (all && entry.visibility === 1 && (entry.type === "actor.seen" || entry.type === "channel.created"))
    return [event()];
  if (!isTailMessage(entry, renewals) || !matchesEventChannel(String(entry.channel), filters.channel)) return [];
  const message = event() as FeedEvent;
  return matchesTailEvent(message, filters, previous, root) ? [message] : [];
}

function filteredEvent(row: Row, filters: EventFilters, all: boolean, renewals: boolean): Page["events"] {
  const entry = { type: String(row.type), visibility: Number(row.visibility), channel: String(row.channel) };
  const build = () => {
    if (entry.type === "watch.failed") return watchFailedEvent(row);
    return entry.visibility === 1 ? bookkeepingEvent(row) : messageEvent(row);
  };
  const kept = feedEvent(entry, build, filters, all, renewals, snapshot(row.root), snapshot(row.previous));
  if (entry.type === "watch.failed" || kept.length === 0 || typeof row.current !== "string") return kept;
  return [{ ...(kept[0] as FeedEvent), current: JSON.parse(row.current) as Message }];
}

/** How a feed read scans: bookkeeping only for `all` without filters; earlier versions for history filters. */
function scanOf(filters: NonNullable<Filters>) {
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
  return { all, history };
}

/**
 * The feed page a forward read from `page.after` scans right after this commit, from the committed events alone. A
 * newest read, a scan longer than one read's 200 rows, or a filter that needs an earlier version or the thread root
 * is left to the store.
 */
export function committedEvents(page: CommittedPage): CommittedEvents {
  return {
    after: page.after,
    head: page.head,
    read(filters = {}) {
      const { all, history } = scanOf(filters);
      if (filters.last !== undefined || history || page.events.length > FORWARD_LIMIT) return undefined;
      const events = page.events.flatMap((event) =>
        feedEvent(event, () => event as Page["events"][number], filters, all, filters.all === true),
      );
      return { head: page.head, cursor: page.head, events };
    },
  };
}

export function eventReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "readEvents"> {
  return {
    async readEvents(after, filters = {}) {
      const { last } = filters;
      const selected = filters.channel === undefined ? undefined : channelFilter(filters.channel);
      const { all, history } = scanOf(filters);
      // Like upstream's local feed, bound the lookback when filtering historical payloads.
      const limit =
        last === undefined
          ? FORWARD_LIMIT
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
          watchFailures: !history && filters.from === undefined && filters.authors === undefined ? 1 : 0,
          rootLabels: filters.labels?.length ? 1 : 0,
          all: all ? 1 : 0,
          renewals: filters.all === true ? 1 : 0,
        },
      );
      const first = rows[0];
      if (!first) throw new Error("the scoped board is missing");
      const head = Number(first.head);
      const cursor = Number(rows.at(-1)?.id ?? head);
      const events = rows.flatMap((row) => filteredEvent(row, filters, all, filters.all === true));
      if (last === undefined) return { head, cursor, events };
      return { head, cursor: head, events: events.slice(0, last).reverse() };
    },
  };
}
