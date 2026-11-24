import { BoardError, type readEvents } from "@openboard/contract";
import { formatId, isoTime, messages, parseId } from "@openboard/core";
import type { Handler } from "./index.ts";

export const readEventsHandler: Handler<typeof readEvents> = async ({ board }, { after }) => {
  const position = after === undefined ? undefined : parseId(after);
  if (position === null) throw new BoardError("invalid_cursor", "after: expected a decimal board cursor");

  const { events, cursor, head } = await board.readEvents(position);
  if (position !== undefined && position > head) {
    throw new BoardError("invalid_cursor", "after: cursor is ahead of the board");
  }
  return {
    cursor: formatId(cursor),
    events: events.map((event) => {
      if (event.type === "message.deleted") {
        const { view, ...payload } = event.payload;
        return {
          cursor: formatId(event.id),
          type: event.type,
          createdAt: isoTime(event.at),
          payload,
          message: view,
        };
      }
      if (event.type === "message.edited") {
        const { view, ...payload } = event.payload;
        return {
          cursor: formatId(event.id),
          type: event.type,
          createdAt: isoTime(event.at),
          payload,
          message: view,
        };
      }
      // `author` (shown on `message`) and mention details belong to the message view. The client key is internal.
      const { author: _author, clientId: _clientId, mentions: _mentions, ...payload } = event.payload;
      return {
        cursor: formatId(event.id),
        type: event.type,
        createdAt: isoTime(event.at),
        payload: { ...payload, attachments: [...payload.attachments], links: [...payload.links] },
        message: messages.messageView(event),
      };
    }),
  };
};
