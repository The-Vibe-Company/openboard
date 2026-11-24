import {
  BoardError,
  type deleteMessage,
  type editMessage,
  type labelMessage,
  type listMessages,
  type Message,
  type postMessage,
  type reactToMessage,
  type readPost,
} from "@openboard/contract";
import { decideDelete, decideEdit, decideLabels, decideReaction, formatId, messages, parseId } from "@openboard/core";
import type { BoardWriter, MentionEvidence } from "@openboard/ports";
import { canListMentionActors, canReadChannel, withoutMentionDetails } from "../auth/access.ts";
import { authorOf } from "../auth/author.ts";
import type { BoardContext, Handler } from "./index.ts";

/**
 * A new thread, or a reply: the message `re` names, the one its `after` names with the first reply after it, the post
 * its client ID already landed, and the board's record of the writer are read under the board's lock, so of replies
 * racing after one message one lands (D33); a non-ID names no message. A retry appends nothing.
 */
export const postMessageHandler: Handler<typeof postMessage> = async (ctx, input) => {
  messages.checkPost(input, ctx.by);
  ctx.debitWrite();
  const { message, replay } = await writeWithMentionVisibility(
    ctx,
    input.text,
    async (writer, mentions) => {
      const re = input.re === undefined ? null : parseId(input.re);
      const target = re === null ? null : await writer.replyTarget(re);
      const after = input.after === undefined ? null : await afterState(writer, input.after);
      const landed = input.id === undefined ? null : await writer.clientPost(input.id);
      const state = { head: writer.head, target, actor: writer.actor, landed, after };
      const context = { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() };
      const replayed = messages.replayPost(state, input, context);
      if (replayed) return { message: replayed, replay: true };
      const settled = await resolvePostMentions(
        writer,
        ctx,
        input.text,
        input.channel ?? target?.channel,
        target?.thread,
        mentions,
      );
      const decided = messages.decidePost(state, input, context, settled);
      await writer.append(decided.events);
      return { message: decided.message, replay: false };
    },
    ctx.by.actor,
  );
  return postAnswer(replay ? await visibleReplay(ctx, message) : message);
};

function postAnswer(message: Message) {
  return { message, ...(message.mentions === undefined ? {} : { mentions: message.mentions }) };
}

interface MentionVisibility {
  readonly handles: ReadonlySet<string>;
  /** Null when the caller may read the board-wide directory. */
  readonly scoped: readonly MentionEvidence[] | null;
}

async function visibleEvidence(ctx: BoardContext, handles: ReadonlySet<string>) {
  const evidence = await ctx.board.mentionEvidence(handles);
  const proofByActor = new Map<string, MentionEvidence>();
  for (const proof of evidence) {
    const { actor, channel, reference } = proof;
    if (
      actor !== ctx.by.actor &&
      canReadChannel(ctx.by, channel) &&
      (reference === null || messages.referencesActor(reference, actor))
    ) {
      const previous = proofByActor.get(actor);
      if (!previous || previous.id < proof.id) proofByActor.set(actor, proof);
    }
  }
  return [...proofByActor.values()];
}

// Search for candidate visibility outside the write lock. Check only the selected proof messages under the lock.
export async function writeWithMentionVisibility<T>(
  ctx: BoardContext,
  text: string,
  decide: (writer: BoardWriter, visibility: MentionVisibility) => Promise<T>,
  actor?: string,
): Promise<T> {
  const handles = messages.mentionedHandles(text);
  const restricted = handles.size > 0 && !canListMentionActors(ctx.by);
  const scoped = restricted ? await visibleEvidence(ctx, handles) : null;
  return ctx.board.write((writer) => decide(writer, { handles, scoped }), actor);
}

/** A post-only author can recover their original keyed write, free of later changes such as adoption. */
async function blindRootSnapshot(ctx: BoardContext, message: Message): Promise<Message | null> {
  const root = parseId(message.id);
  if (root === null) throw new Error("invalid stored task position");
  const { events } = await ctx.board.readEvents(root - 1, { thread: message.id });
  const [posted, created] = events;
  if (created?.type === "task.created" && created.id === root + 1 && created.payload.blind !== undefined) {
    return created.payload.blind ? created.payload.view : null;
  }
  if (posted?.type !== "message.posted" || posted.id !== root) return null;
  return withoutMentionDetails(messages.messageView(posted));
}

export async function visibleReplay(ctx: BoardContext, message: Message): Promise<Message> {
  if (message.task && !canReadChannel(ctx.by, message.channel)) {
    const original = await blindRootSnapshot(ctx, message);
    if (!original) throw new BoardError("duplicate_id", "the client ID was already used for a different post");
    return original;
  }
  if (!message.mentions || canListMentionActors(ctx.by)) return message;
  if (!canReadChannel(ctx.by, message.channel)) return withoutMentionDetails(message);
  const handles = new Set(
    message.mentions.flatMap(({ actor, candidates }) =>
      [...(actor ? [actor] : []), ...candidates].map((entry) => entry.handle.toLowerCase()),
    ),
  );
  if (handles.size === 0) return message;
  const evidence = await visibleEvidence(ctx, handles);
  const actors = new Set([ctx.by.actor, ...evidence.map(({ actor }) => actor)]);
  return {
    ...message,
    mentions: message.mentions.flatMap((mention) => {
      if (mention.actor && !actors.has(mention.actor.id)) return [];
      return [{ ...mention, candidates: mention.candidates.filter(({ id }) => actors.has(id)) }];
    }),
  };
}

export async function resolvePostMentions(
  writer: BoardWriter,
  ctx: BoardContext,
  text: string,
  channel: string | undefined,
  thread: number | undefined,
  { handles, scoped }: MentionVisibility,
): Promise<Parameters<typeof messages.decidePost>[3]> {
  if (handles.size === 0 || channel === undefined) return undefined;
  // A writer that cannot read the channel looks no one up, but its handles stay recorded as mentions of no one.
  if (!canReadChannel(ctx.by, channel)) return messages.settleMentions(text, handles, []);
  const candidates = await writer.mentionActors(handles);
  const visible = scoped && (await writer.unchangedMentionEvidence(scoped));
  const actors = visible ? candidates.filter(({ id }) => visible.has(id)) : candidates;
  let safeHandles = handles;
  if (scoped && visible) {
    const dropped = new Set(scoped.filter(({ actor }) => !visible.has(actor)).map(({ actor }) => actor));
    safeHandles = messages.safeMentionHandles(handles, candidates, dropped);
    const { handle, name } = authorOf(ctx.by);
    actors.push({ id: ctx.by.actor, handle, name });
  }
  const settled = messages.settleMentions(text, safeHandles, actors);
  if (thread === undefined || !settled.mentions.some(({ candidates }) => candidates.length > 1)) return settled;
  return messages.settleMentions(text, safeHandles, actors, await writer.threadWriters(thread));
}

export const editMessageHandler: Handler<typeof editMessage> = async (ctx, input) => {
  const position = parseId(input.id);
  return writeWithMentionVisibility(ctx, input.text, async (writer, mentions) => {
    const target = position === null ? null : await writer.message(position);
    const settled = await resolvePostMentions(
      writer,
      ctx,
      input.text,
      target?.channel,
      parseId(target?.thread ?? "") ?? undefined,
      mentions,
    );
    const event = decideEdit({ head: writer.head, target }, input, { by: ctx.by, now: ctx.now() }, settled);
    ctx.debitWrite();
    await writer.append([event]);
    const { mentions: resolved } = event.payload.view;
    return { ok: true, ...(resolved === undefined ? {} : { mentions: resolved }) };
  });
};

export const deleteMessageHandler: Handler<typeof deleteMessage> = async (ctx, input) => {
  const position = parseId(input.id);
  await ctx.board.write(async (writer) => {
    const target = position === null ? null : await writer.message(position);
    const events = decideDelete({ head: writer.head, target }, input, { by: ctx.by, now: ctx.now() });
    ctx.debitWrite();
    if (events.length > 0) await writer.append(events);
  });
  return { ok: true };
};

/** The reaction is decided with the message and the board's record of the writer read under the board's lock. */
export const reactToMessageHandler: Handler<typeof reactToMessage> = async (ctx, input) => {
  const position = parseId(input.id);
  ctx.debitWrite();
  await ctx.board.write(async (writer) => {
    const target = position === null ? null : await writer.message(position);
    const state = { head: writer.head, target, actor: writer.actor };
    const events = decideReaction(state, input, { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() });
    if (events.length > 0) await writer.append(events);
  }, ctx.by.actor);
  return { ok: true };
};

/** The label write is decided with the message and the board's record of the writer read under the board's lock. */
export const labelMessageHandler: Handler<typeof labelMessage> = async (ctx, input) => {
  ctx.debitWrite();
  const position = parseId(input.id);
  await ctx.board.write(async (writer) => {
    const target = position === null ? null : await writer.message(position);
    const state = { head: writer.head, target, actor: writer.actor };
    await writer.append(decideLabels(state, input, { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() }));
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
  return {
    messages: canListMentionActors(ctx.by) ? page : page.map(withoutMentionDetails),
    cursor: page.at(-1)?.id ?? formatId(after ?? 0),
  };
};

export const readPostHandler: Handler<typeof readPost> = async (ctx, { id }) => {
  const landed = await ctx.board.ownClientPost(id, ctx.by);
  const message =
    landed?.task && !canReadChannel(ctx.by, landed.channel) ? await blindRootSnapshot(ctx, landed) : landed;
  if (!message) throw new BoardError("post_not_found", "no post of yours has that client ID");
  return { message: canListMentionActors(ctx.by) ? message : withoutMentionDetails(message) };
};
