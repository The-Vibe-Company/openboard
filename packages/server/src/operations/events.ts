import { BoardError, type OutputOf, type readEvents } from "@openboard/contract";
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
import { canListMentionActors, canReadChannel, withoutMentionDetails } from "../auth/access.ts";
import { longPoll } from "../live/long-poll.ts";
import type { Handler } from "./index.ts";

export const readEventsHandler: Handler<typeof readEvents> = async (
  { board, by, schedule, signal, reauthorize },
  { after, last, wait, channel, re, label, from, text, by: author, mentions },
) => {
  if (last !== undefined && (after !== undefined || wait !== undefined)) {
    throw new BoardError("invalid_request", "`last` reads the newest events at once: it takes no `after` or `wait`");
  }
  const position = after === undefined ? undefined : parseId(after);
  if (position === null) throw new BoardError("invalid_cursor", "after: expected a decimal board cursor");

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
  const page = await longPoll(board, position, wait, signal, schedule, async (after) => {
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
    const { events, cursor, head } = await board.readEvents(after, {
      ...filters,
      authors: author === undefined ? undefined : eventAuthors(author, current.actor, actors),
      mentions: mentions === undefined ? undefined : eventMentions(mentions, current.actor, mentionActors),
    });
    if (after !== undefined && after > head) {
      throw new BoardError("invalid_cursor", "after: cursor is ahead of the board");
    }
    if (wait) {
      // A write can introduce an actor between lookup and scan. Re-read without advancing the cursor in that case.
      const latest = after === undefined ? actors : await lookup();
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
        .filter((event) => canReadChannel(current, event.channel))
        .flatMap((event) => projectEvent(event, revealMentions, text !== undefined || mentions !== undefined)),
    };
  });
  return { cursor: formatId(page.cursor), events: page.events };
};

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
  const current = event.current;
  const historical = event.type === "message.posted" ? messages.messageView(event) : event.payload.view;
  if (current !== undefined && byWords && (current.deleted || current.text !== historical.text)) return [];

  const visible = (view: ReturnType<typeof messages.messageView>) => (everywhere ? view : withoutMentionDetails(view));
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
