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
      // `author` (shown on `message`) and `clientId` are OpenBoard's records; upstream's payload has neither.
      const { author: _author, clientId: _clientId, ...payload } = event.payload;
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
