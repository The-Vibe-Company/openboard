import {
  BoardError,
  type deleteMessage,
  type editMessage,
  type listMessages,
  type postMessage,
  type reactToMessage,
  type readPost,
} from "@openboard/contract";
import { decideDelete, decideEdit, decideReaction, formatId, messages, parseId } from "@openboard/core";
import type { BoardWriter } from "@openboard/ports";
import { authorOf } from "../auth/author.ts";
import type { Handler } from "./index.ts";

/**
 * A new thread, or a reply: the message `re` names, the one its `after` names with the first reply after it, the post
 * its client ID already landed, and the board's record of the writer are read under the board's lock, so of replies
 * racing after one message one lands (D33); a non-ID names no message. A retry appends nothing.
 */
export const postMessageHandler: Handler<typeof postMessage> = async (ctx, input) => {
  const message = await ctx.board.write(async (writer) => {
    messages.checkPost(input, ctx.by);
    const re = input.re === undefined ? null : parseId(input.re);
    const target = re === null ? null : await writer.replyTarget(re);
    const after = input.after === undefined ? null : await afterState(writer, input.after);
    const landed = input.id === undefined ? null : await writer.clientPost(input.id);
    const state = { head: writer.head, target, actor: writer.actor, landed, after };
    const context = { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() };
    const replayed = messages.replayPost(state, input, context);
    if (replayed) return replayed;
    const decided = messages.decidePost(state, input, context);
    await writer.append(decided.events);
    return decided.message;
  }, ctx.by.actor);
  return { message };
};

export const editMessageHandler: Handler<typeof editMessage> = async (ctx, input) => {
  const position = parseId(input.id);
  await ctx.board.write(async (writer) => {
    const target = position === null ? null : await writer.message(position);
    const event = decideEdit({ head: writer.head, target }, input, { by: ctx.by, now: ctx.now() });
    await writer.append([event]);
  });
  return { ok: true };
};

export const deleteMessageHandler: Handler<typeof deleteMessage> = async (ctx, input) => {
  const position = parseId(input.id);
  await ctx.board.write(async (writer) => {
    const target = position === null ? null : await writer.message(position);
    const event = decideDelete({ head: writer.head, target }, input, { by: ctx.by, now: ctx.now() });
    if (event) await writer.append([event]);
  });
  return { ok: true };
};

/** The reaction is decided with the message and the board's record of the writer read under the board's lock. */
export const reactToMessageHandler: Handler<typeof reactToMessage> = async (ctx, input) => {
  const position = parseId(input.id);
  await ctx.board.write(async (writer) => {
    const target = position === null ? null : await writer.message(position);
    const state = { head: writer.head, target, actor: writer.actor };
    const events = decideReaction(state, input, { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() });
    if (events.length > 0) await writer.append(events);
  }, ctx.by.actor);
  return { ok: true };
};

/** What a reply's `after` names, with the first reply of its thread after it; null when it names no message. */
async function afterState(writer: BoardWriter, after: string): Promise<messages.AfterState | null> {
  const id = parseId(after);
  const message = id === null ? null : await writer.replyTarget(id);
  if (!message) return null;
  return { id: message.id, thread: message.thread, newer: await writer.newerReply(message.thread, message.id) };
}

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

export const readPostHandler: Handler<typeof readPost> = async (ctx, { id }) => {
  const message = await ctx.board.ownClientPost(id, ctx.by);
  if (!message) throw new BoardError("post_not_found", "no post of yours has that client ID");
  return { message };
};
