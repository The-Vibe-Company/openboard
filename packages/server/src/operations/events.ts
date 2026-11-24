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
    return (await longPoll(tail, position, seconds, ctx.signal, ctx.schedule, read)) ?? (await read(position));
  } finally {
    tail.close();
  }
}

export async function streamEvents(
  ctx: BoardContext,
  input: EventInput,
  lastEventId: string | null,
): Promise<Response> {
  const { position, read, newest } = prepareFeed(ctx, input, true, lastEventId);
  // Subscribe before the first read: the stream then follows from memory, and reads the store only when behind.
  const tail = tailBoard(ctx.board, position);
  try {
    tail.take(position);
    let first = await read(position);
    while (first.retry && !ctx.signal.aborted) first = await read(position);
    tail.settle(first);
    const follow = newest ? prepareFeed(ctx, { ...input, last: undefined }, true).read : read;
    return eventStream(
      first,
      ctx.signal,
      ctx.schedule,
      (after, signal) => longPoll(tail, after, "stream", signal, ctx.schedule, follow),
      tail.close,
    );
  } catch (error) {
    tail.close();
    throw error;
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
      // Events about no message show only to a caller that reads every channel (upstream `03-http.md`).
      all: (all === "true" || all === "1") && everywhere,
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

function projectEvent(event: FeedEvent, everywhere: boolean, byWords: boolean): OutputOf<typeof readEvents>["events"] {
  if (event.visibility === 1) {
    const common = { cursor: formatId(event.id), createdAt: isoTime(event.at) };
    return event.type === "actor.seen"
      ? [{ ...common, type: event.type, payload: { ...event.payload } }]
      : [{ ...common, type: event.type, payload: { ...event.payload } }];
  }
  const current = event.current;
  const historical = event.type === "message.posted" ? messages.messageView(event) : event.payload.view;
  if (current !== undefined && byWords && (current.deleted || current.text !== historical.text)) return [];

  const visible = (view: ReturnType<typeof messages.messageView>) => (everywhere ? view : withoutMentionDetails(view));
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
  if (event.type === "message.deleted") {
    const { view, ...payload } = event.payload;
    return [
      {
        cursor: formatId(event.id),
        type: event.type,
        createdAt: isoTime(event.at),
        payload,
        message: visible(current ?? view),
      },
    ];
  }
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

function projectTaskCreated(
  event: Extract<FeedEvent, { type: "task.created" }>,
  message: ReturnType<typeof messages.messageView>,
) {
  const { view: _view, id, needs, ...payload } = event.payload;
  return {
    cursor: formatId(event.id),
    type: event.type,
    createdAt: isoTime(event.at),
    payload: { ...payload, id: formatId(id), needs: needs.map(formatId) },
    message,
  };
}
