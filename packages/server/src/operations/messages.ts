import { BoardError, type listMessages, type postMessage } from "@openboard/contract";
import { formatId, messages, parseId } from "@openboard/core";
import type { Handler } from "./index.ts";

/** A new thread, or a reply: the message `re` names is read under the board's lock; a non-ID names no message. */
export const postMessageHandler: Handler<typeof postMessage> = async (ctx, input) => {
  const message = await ctx.board.write(async (writer) => {
    const re = input.re === undefined ? null : parseId(input.re);
    const target = re === null ? null : await writer.replyTarget(re);
    const decided = messages.decidePost({ head: writer.head, target }, input, { by: ctx.by, now: ctx.now() });
    await writer.append(decided.events);
    return decided.message;
  });
  return { message };
};

/**
 * A channel's messages after `after`, or its latest; the cursor is the last one's ID, so reading on from it repeats
 * and skips nothing. An empty page keeps the cursor it was read from, or "0" for a channel nobody has posted in.
 */
export const listMessagesHandler: Handler<typeof listMessages> = async (ctx, input) => {
  const after = input.after === undefined ? undefined : parseId(input.after);
  if (after === null) throw new BoardError("invalid_cursor", "after: expected a decimal board cursor");
  const query = { channel: input.channel, limit: input.limit ?? 50 };
  const page = await ctx.board.channelMessages(after === undefined ? query : { ...query, after });
  if (page === null) throw new BoardError("invalid_cursor", "after: cursor is ahead of the board");
  return { messages: page, cursor: page.at(-1)?.id ?? formatId(after ?? 0) };
};
