import { BoardError, type InputOf, type OutputOf, type readEvents } from "@openboard/contract";
import {
  eventAuthors,
  eventMentions,
  formatId,
  isoTime,
  labelFilters,
  mentionFilter,
  messages,
  parseId,
} from "@openboard/core";
import type { CommittedEvents } from "@openboard/ports";
import { canListMentionActors, canReadChannel, withoutMentionDetails } from "../auth/access.ts";
import { tailBoard } from "../live/fan-out.ts";
import { longPoll } from "../live/long-poll.ts";
import { eventStream } from "../live/sse.ts";
import type { BoardContext, Handler } from "./index.ts";
import {
  projectTaskBlocked,
  projectTaskNeedsChanged,
  projectTaskReady,
  projectTaskReopened,
  projectTaskUnblocked,
} from "./tasks/feed.ts";

type EventInput = InputOf<typeof readEvents>;

export const readEventsHandler: Handler<typeof readEvents> = async (ctx, input) => {
  const { position, read } = prepareFeed(ctx, input);
  const page = input.wait ? await waitForEvents(ctx, position, input.wait, read) : await read(position);
  return { cursor: formatId(page.cursor), events: page.events };
};

async function waitForEvents(
  ctx: BoardContext,
  position: number | undefined,
  seconds: number,
  read: ReturnType<typeof prepareFeed>["read"],
) {
  const tail = tailBoard(ctx.board, position);
  try {
    // A new tail reads the store first, so the wait always resolves a page; the read only satisfies the type.
    const signal = AbortSignal.any([ctx.signal, ctx.shutdown]);
    const page = (await longPoll(tail, position, seconds, signal, ctx.schedule, read)) ?? (await read(position));
    // A timeout can return the last empty page without running its read again.
    if (page.events.length === 0) await ctx.reauthorize();
    return page;
  } finally {
    tail.close();
  }
}

export async function streamEvents(
  ctx: BoardContext,
  input: EventInput,
  lastEventId: string | null,
  track: <T>(work: Promise<T>) => Promise<T>,
  reserve: () => () => void,
): Promise<Response> {
  const { position, read, newest } = prepareFeed(ctx, input, true, lastEventId);
  const opening = AbortSignal.any([ctx.signal, ctx.shutdown]);
  if (opening.aborted) throw new BoardError("unavailable", "the event stream request ended");
  const release = reserve();
  let closeTail: (() => void) | undefined;
  const close = () => {
    release();
    const stopTail = closeTail;
    closeTail = undefined;
    stopTail?.();
  };
  try {
    // Subscribe before the first read: the stream then follows from memory, and reads the store only when behind.
    const tail = tailBoard(ctx.board, position);
    closeTail = tail.close;
    opening.addEventListener("abort", close, { once: true });
    tail.take(position);
    let first = await read(position);
    while (first.retry && !opening.aborted) first = await read(position);
    if (ctx.shutdown.aborted) throw new BoardError("unavailable", "the instance is draining");
    if (opening.aborted) throw new BoardError("unavailable", "the event stream request ended");
    tail.settle(first);
    const follow = newest ? prepareFeed(ctx, { ...input, last: undefined }, true).read : read;
    return eventStream(
      first,
      ctx.signal,
      ctx.shutdown,
      ctx.schedule,
      (after, signal) => track(longPoll(tail, after, "stream", signal, ctx.schedule, follow)),
      close,
    );
  } catch (error) {
    close();
    throw error;
  } finally {
    opening.removeEventListener("abort", close);
  }
}

function eventStart({ after, last, wait }: EventInput, lastEventId?: string | null) {
  if (last !== undefined && (after !== undefined || wait !== undefined)) {
    throw new BoardError("invalid_request", "`last` reads the newest events at once: it takes no `after` or `wait`");
  }

  // Upstream treats a nonempty header of up to 128 characters as an event reference.
  const cursor = after ?? (lastEventId && lastEventId.length <= 128 ? lastEventId : undefined);
  const position = cursor === undefined ? undefined : parseId(cursor);
  if (position === null) throw new BoardError("invalid_cursor", "after: expected a decimal board cursor");
  return { position, last: cursor === undefined ? last : undefined };
}

function prepareFeed(
  { board, by, reauthorize }: BoardContext,
  input: EventInput,
  streaming = false,
  lastEventId?: string | null,
) {
  const { wait, all, channel, re, label, from, text, by: author, mentions } = input;
  const { position, last } = eventStart(input, lastEventId);
  const thread = re === undefined ? undefined : parseId(re);
  if (thread === null) throw new BoardError("invalid_request", "re: expected a decimal thread ID");
  const authorLookup = author === "me" ? undefined : author;
  const filters = {
    channel,
    last,
    thread: thread === undefined ? undefined : formatId(thread),
    labels: labelFilters(label),
    from,
    text: text?.toLowerCase(),
  };
  let current = by;
  const read = async (after: number | undefined, committed?: CommittedEvents) => {
    const everywhere = canListMentionActors(current);
    const named = mentions === undefined ? undefined : mentionFilter(mentions, current.actor, everywhere);
    const mentionLookup = named?.resolve ? named : undefined;
    const lookup = () =>
      authorLookup !== undefined || mentionLookup !== undefined
        ? board.findFilterActors(authorLookup, mentionLookup)
        : [];
    const actors = await lookup();
    const mentionActors = everywhere
      ? actors
      : mentions === "me"
        ? actors.filter(({ id }) => id === current.actor)
        : [];
    const scan = {
      ...filters,
      // The store excludes board-wide bookkeeping from channel-filtered reads.
      all: (all === "true" || all === "1") && (everywhere || channel !== undefined),
      authors: author === undefined ? undefined : eventAuthors(author, current.actor, actors),
      mentions: mentions === undefined ? undefined : eventMentions(mentions, current.actor, mentionActors),
    };
    // A committed page that starts at the cursor answers from memory; access is still applied below, per caller.
    const fromMemory = committed !== undefined && committed.after === after ? committed.read(scan) : undefined;
    const { events, cursor, head } = fromMemory ?? (await board.readEvents(after, scan));
    if (after !== undefined && after > head) {
      throw new BoardError("invalid_cursor", "after: cursor is ahead of the board");
    }
    if (wait || streaming) {
      // A write can introduce an actor between lookup and scan. Re-read without advancing the cursor in that case.
      const latest = after === undefined && last === undefined ? actors : await lookup();
      current = await reauthorize();
      if ((mentions !== undefined && everywhere !== canListMentionActors(current)) || !sameActors(actors, latest)) {
        return { cursor: after ?? head, head, events: [], retry: true };
      }
    }
    const revealMentions = canListMentionActors(current);
    return {
      head,
      cursor,
      events: events
        .filter((event) => (event.visibility === 1 ? revealMentions : canReadChannel(current, event.channel)))
        .flatMap((event) => projectEvent(event, revealMentions, text !== undefined || mentions !== undefined)),
    };
  };
  return { position, read, newest: last !== undefined };
}

type FilterActors = Awaited<ReturnType<Parameters<typeof readEventsHandler>[0]["board"]["findFilterActors"]>>;

function sameActors(before: FilterActors, after: FilterActors): boolean {
  if (before === after) return true;
  if (before.length !== after.length) return false;
  const byId = new Map(after.map((actor) => [actor.id, actor]));
  return before.every(({ id, kind, handle }) => {
    const actor = byId.get(id);
    return actor?.kind === kind && actor.handle === handle;
  });
}

type FeedEvent = Awaited<ReturnType<Parameters<typeof readEventsHandler>[0]["board"]["readEvents"]>>["events"][number];

type WireEvents = OutputOf<typeof readEvents>["events"];

export function projectEvent(event: FeedEvent, everywhere: boolean, byWords: boolean): WireEvents {
  if (event.visibility === 1 || event.type === "watch.failed") return [projectBookkeepingEvent(event)];
  const current = event.current;
  const historical = event.type === "message.posted" ? messages.messageView(event) : event.payload.view;
  if (current !== undefined && byWords && (current.deleted || current.text !== historical.text)) return [];

  const visible = (view: ReturnType<typeof messages.messageView>) => (everywhere ? view : withoutMentionDetails(view));
  if (event.type === "task.expired") return [projectTaskExpired(event, visible(current ?? historical))];
  if (event.type === "task.released") return [projectTaskReleased(event, visible(current ?? historical))];
  if (event.type === "task.ready") return [projectTaskReady(event, visible(current ?? historical))];
  if (event.type === "task.reopened") return [projectTaskReopened(event, visible(current ?? historical))];
  if (event.type === "task.needs_changed") return [projectTaskNeedsChanged(event, visible(current ?? historical))];
  if (event.type === "task.unblocked") return [projectTaskUnblocked(event, visible(current ?? historical))];
  if (event.type === "task.blocked") return [projectTaskBlocked(event, visible(current ?? historical))];
  if (event.type === "task.canceled") return [projectTaskCanceled(event, visible(current ?? historical))];
  if (event.type === "task.failed") return [projectTaskFailed(event, visible(current ?? historical))];
  if (event.type === "task.completed") return [projectTaskCompleted(event, visible(current ?? historical))];
  if (event.type === "task.claimed" || event.type === "task.renewed")
    return [projectTaskLease(event, visible(current ?? historical))];
  if (event.type === "task.created") return [projectTaskCreated(event, visible(current ?? historical))];
  if (event.type === "labels.changed") {
    const { view, set, unset, ...payload } = event.payload;
    const carried =
      current === undefined
        ? set
        : Object.fromEntries(
            Object.entries(set).filter(
              ([key, value]) => Object.hasOwn(current.labels, key) && current.labels[key] === value,
            ),
          );
    return [
      {
        cursor: formatId(event.id),
        type: event.type,
        createdAt: isoTime(event.at),
        payload: { ...payload, set: carried, unset: [...unset] },
        message: visible(current ?? view),
      },
    ];
  }
  if (event.type === "message.deleted") return [projectDeletion(event, visible(current ?? historical))];
  if (event.type === "message.edited") {
    const { view, ...payload } = event.payload;
    return [
      {
        cursor: formatId(event.id),
        type: event.type,
        createdAt: isoTime(event.at),
        payload: { ...payload, text: current?.text ?? payload.text },
        message: visible(current ?? view),
      },
    ];
  }
  // `author` (shown on `message`) and mention details belong to the message view. The client key is internal.
  const { author: _author, clientId: _clientId, mentions: _mentions, ...payload } = event.payload;
  return [
    {
      cursor: formatId(event.id),
      type: event.type,
      createdAt: isoTime(event.at),
      payload: {
        ...payload,
        text: current?.text ?? payload.text,
        labels: current?.labels ?? payload.labels,
        attachments: current?.attachments ?? [...payload.attachments],
        links: current?.links ?? [...payload.links],
      },
      message: visible(current ?? historical),
    },
  ];
}

function projectBookkeepingEvent(
  event: Extract<FeedEvent, { visibility: 1 } | { type: "watch.failed" }>,
): WireEvents[number] {
  const common = { cursor: formatId(event.id), createdAt: isoTime(event.at) };
  if (event.type === "watch.failed") return { ...common, type: event.type, payload: event.payload };
  if (event.type === "actor.seen") return { ...common, type: event.type, payload: event.payload };
  return { ...common, type: event.type, payload: event.payload };
}

function projectDeletion(
  event: Extract<FeedEvent, { type: "message.deleted" }>,
  message: ReturnType<typeof messages.messageView>,
) {
  const { view: _view, ...payload } = event.payload;
  return { cursor: formatId(event.id), type: event.type, createdAt: isoTime(event.at), payload, message };
}

function projectTaskExpired(
  event: Extract<FeedEvent, { type: "task.expired" }>,
  message: ReturnType<typeof messages.messageView>,
): WireEvents[number] {
  const { id, epoch } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { id: formatId(id), epoch },
    message,
  };
}

function projectTaskCreated(
  event: Extract<FeedEvent, { type: "task.created" }>,
  message: ReturnType<typeof messages.messageView>,
) {
  const { view: _view, blind: _blind, batch: _batch, waitingOn: _waitingOn, id, needs, ...payload } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { ...payload, id: formatId(id), needs: needs.map(formatId) },
    message,
  };
}

function projectTaskLease(
  event: Extract<FeedEvent, { type: "task.claimed" | "task.renewed" }>,
  message: ReturnType<typeof messages.messageView>,
) {
  const { id, thread, epoch, until, by } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { id: formatId(id), thread, epoch, until, by },
    message,
  };
}

function projectTaskCompleted(
  event: Extract<FeedEvent, { type: "task.completed" }>,
  message: ReturnType<typeof messages.messageView>,
) {
  const { id, thread, epoch, result, by } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { id: formatId(id), thread, epoch, result, by },
    message,
  };
}

function projectTaskCanceled(
  event: Extract<FeedEvent, { type: "task.canceled" }>,
  message: ReturnType<typeof messages.messageView>,
) {
  const { id, thread, reason, by } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { id: formatId(id), thread, reason, by },
    message,
  };
}

function projectTaskFailed(
  event: Extract<FeedEvent, { type: "task.failed" }>,
  message: ReturnType<typeof messages.messageView>,
) {
  const { id, thread, epoch, reason, by } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { id: formatId(id), thread, epoch, reason, by },
    message,
  };
}

function projectTaskReleased(
  event: Extract<FeedEvent, { type: "task.released" }>,
  message: ReturnType<typeof messages.messageView>,
) {
  const { id, thread, epoch, by } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { id: formatId(id), thread, epoch, by },
    message,
  };
}
