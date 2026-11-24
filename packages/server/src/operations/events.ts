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
import type { Handler } from "./index.ts";

export const readEventsHandler: Handler<typeof readEvents> = async (
  { board, by },
  { after, last, wait, channel, re, label, from, text, by: author, mentions },
) => {
  if (last !== undefined && (after !== undefined || wait !== undefined)) {
    throw new BoardError("invalid_request", "`last` reads the newest events at once: it takes no `after` or `wait`");
  }
  const position = after === undefined ? undefined : parseId(after);
  if (position === null) throw new BoardError("invalid_cursor", "after: expected a decimal board cursor");

  const thread = re === undefined ? undefined : parseId(re);
  if (thread === null) throw new BoardError("invalid_request", "re: expected a decimal thread ID");
  const everywhere = canListMentionActors(by);
  const authorLookup = author === "me" ? undefined : author;
  const named = mentions === undefined ? undefined : mentionFilter(mentions, by.actor, everywhere);
  const mentionLookup = named?.resolve ? named : undefined;
  const actors =
    authorLookup !== undefined || mentionLookup !== undefined
      ? await board.findFilterActors(authorLookup, mentionLookup)
      : [];
  const mentionActors = everywhere ? actors : mentions === "me" ? actors.filter(({ id }) => id === by.actor) : [];
  const { events, cursor, head } = await board.readEvents(position, {
    channel,
    last,
    thread: thread === undefined ? undefined : formatId(thread),
    labels: labelFilters(label),
    from,
    text: text?.toLowerCase(),
    authors: author === undefined ? undefined : eventAuthors(author, by.actor, actors),
    mentions: mentions === undefined ? undefined : eventMentions(mentions, by.actor, mentionActors),
  });
  if (position !== undefined && position > head) {
    throw new BoardError("invalid_cursor", "after: cursor is ahead of the board");
  }
  return {
    cursor: formatId(cursor),
    events: events
      .filter((event) => canReadChannel(by, event.channel))
      .flatMap((event) => projectEvent(event, everywhere, text !== undefined || mentions !== undefined)),
  };
};

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
