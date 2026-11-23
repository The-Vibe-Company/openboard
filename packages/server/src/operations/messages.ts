import type { listMessages, postMessage } from "@openboard/contract";
import { messages, parseId } from "@openboard/core";
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

/** A channel's latest messages; the cursor is the last one's ID, or "0" for a channel nobody has posted in. */
export const listMessagesHandler: Handler<typeof listMessages> = async (ctx, input) => {
  const page = await ctx.board.channelMessages({ channel: input.channel, limit: input.limit ?? 50 });
  return { messages: page, cursor: page.at(-1)?.id ?? "0" };
};
