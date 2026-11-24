import { BoardError, type readEvents } from "@openboard/contract";
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
  { after, channel, re, label, from, text, by: author, mentions },
) => {
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
      .map((event) => {
        const visible = (view: ReturnType<typeof messages.messageView>) =>
          everywhere ? view : withoutMentionDetails(view);
        if (event.type === "labels.changed") {
          const { view, unset, ...payload } = event.payload;
          return {
            cursor: formatId(event.id),
            type: event.type,
            createdAt: isoTime(event.at),
            payload: { ...payload, unset: [...unset] },
            message: visible(view),
          };
        }
        if (event.type === "message.deleted") {
          const { view, ...payload } = event.payload;
          return {
            cursor: formatId(event.id),
            type: event.type,
            createdAt: isoTime(event.at),
            payload,
            message: visible(view),
          };
        }
        if (event.type === "message.edited") {
          const { view, ...payload } = event.payload;
          return {
            cursor: formatId(event.id),
            type: event.type,
            createdAt: isoTime(event.at),
            payload,
            message: visible(view),
          };
        }
        // `author` (shown on `message`) and mention details belong to the message view. The client key is internal.
        const { author: _author, clientId: _clientId, mentions: _mentions, ...payload } = event.payload;
        return {
          cursor: formatId(event.id),
          type: event.type,
          createdAt: isoTime(event.at),
          payload: { ...payload, attachments: [...payload.attachments], links: [...payload.links] },
          message: visible(messages.messageView(event)),
        };
      }),
  };
};
