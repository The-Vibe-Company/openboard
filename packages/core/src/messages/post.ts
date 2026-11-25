import {
  type Actor,
  type Attachment,
  type Author,
  BoardError,
  type InputOf,
  type Mention,
  type Message,
  type MessageAuthor,
  type postMessage,
} from "@openboard/contract";
import { formatId, isoTime } from "../ids.ts";
import type { MessageBlock } from "../schemas/blocks.ts";
import { checkLabels } from "./labels.ts";
import type { SettledMentions } from "./mentions.ts";

export {
  mentionedHandles,
  redactActorMentions,
  referencesActor,
  safeMentionHandles,
  settleMentions,
} from "./mentions.ts";

/** A new thread (`channel`) or a reply (`re`), as `POST /messages` asks for it once the contract has validated it. */
export interface PostCommand {
  readonly channel?: string;
  readonly re?: string;
  /** A reply's precondition: a message in its thread that must still be the thread's newest. */
  readonly after?: string;
  readonly text: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly noSync?: boolean;
  readonly attachments?: readonly string[];
  readonly sync?: Readonly<NonNullable<InputOf<typeof postMessage>["sync"]>>;
  /** The client's idempotency key: a retry under it gets back the post that landed instead of posting again. */
  readonly id?: string;
}

/**
 * Upstream's `message.posted` payload (upstream `03-http.md` "Event types"): `re` is the root of a reply, and
 * `replyTo` the message it answered when that is not the root.
 */
export interface MessagePostedPayload {
  readonly channel: string;
  readonly text: string;
  readonly re: string | null;
  readonly replyTo: string | null;
  readonly thread: string;
  /** The original handle spellings and their resolution, kept with the message view. */
  readonly mentions?: Mention[];
  /** Internal block projection, retained for replay and rebuilding the views. */
  readonly blocks?: MessageBlock[];
  readonly labels: Readonly<Record<string, string>>;
  readonly noSync: boolean;
  readonly by: Author;
  /** Who wrote it, for people to read; the server resolves it from the credential. Not part of upstream's payload. */
  readonly author?: MessageAuthor;
  /** The client ID it was posted under, which the fold keeps to find it again. Not part of upstream's payload. */
  readonly clientId?: string;
  readonly origin: null;
  readonly from: null;
  readonly attachments: readonly Attachment[];
  readonly links: readonly never[];
}

/** One event of a board's log, as a command appends it; `id` is its position, `at` milliseconds since the epoch. */
export interface MessagePosted {
  readonly id: number;
  readonly type: "message.posted";
  readonly at: number;
  readonly thread: number;
  readonly message: number;
  readonly channel: string;
  readonly actor: string;
  readonly principal: string;
  /** 0: on the feed (docs/data-model.md "Boards and the log"). */
  readonly visibility: 0;
  readonly payload: MessagePostedPayload;
}

/** The message a reply's `re` names, as the board holds it. */
export interface ReplyTarget {
  readonly id: number;
  readonly channel: string;
  /** The log position of its thread's root: its own for a root. */
  readonly thread: number;
}

/** The message a reply's `after` names, as the board holds it, and the first message of its thread after it. */
export interface AfterState {
  readonly id: number;
  /** The log position of the thread's root the message is in: its own for a root. */
  readonly thread: number;
  /** The first message of that thread after it, deleted or not; null when it is still the newest. */
  readonly newer: number | null;
}

/**
 * Upstream's `actor.seen` (upstream `03-http.md` "Event types"): who an actor is, written on its first write or
 * when it shows otherwise. Bookkeeping: served only with `all`.
 */
export interface ActorSeen {
  readonly id: number;
  readonly type: "actor.seen";
  readonly at: number;
  readonly thread: null;
  readonly message: null;
  readonly channel: null;
  readonly actor: string;
  readonly principal: string;
  /** 1: bookkeeping (docs/data-model.md "Boards and the log"). */
  readonly visibility: 1;
  readonly payload: { readonly actor: string } & Omit<Actor, "id">;
}

/**
 * What the board holds when a post is decided, read under the board's lock: its log head, for a reply the message
 * `re` names (null when no message has that ID), and the board's record of the writer (null when it has none; left
 * out, the post records no `actor.seen`).
 */
export interface PostState {
  readonly head: number;
  readonly target?: ReplyTarget | null;
  readonly actor?: Actor | null;
  /** The message the command's `id` already landed with, as the board holds it; null or left out when none did. */
  readonly landed?: Message | null;
  /** For a reply with `after`, what it names; null when no message has that ID. */
  readonly after?: AfterState | null;
}

export interface PostContext {
  readonly by: Author;
  /** How the writer shows; with `state.actor` read, the post records it with `actor.seen` unless that matches it. */
  readonly author?: MessageAuthor;
  readonly now: number;
  readonly blocks?: MessageBlock[];
  readonly attachments?: readonly Attachment[];
}

/** No board string holds a NUL, which Postgres cannot store, or a lone surrogate (upstream `storable`). */
const storable = (value: string) => !value.includes("\0") && value.isWellFormed();
/** The shape of the IDs a board derives for its own writes, a UUIDv8 (upstream `DERIVED_ID`): never a client's. */
const DERIVED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Refuses a client ID that is someone else's to post with: the board's own, a sync's import, or another's key. */
export function checkClientId(id: string, principal: string) {
  if (!storable(id)) throw new BoardError("invalid_request", "id: the ID has a NUL character or a lone surrogate");
  if (DERIVED_ID.test(id)) throw new BoardError("invalid_request", "id: UUIDv8s are the board's own, for its writes");
  if (id.startsWith("sync:")) throw new BoardError("invalid_request", "id: sync:… IDs are what sync imports");
  const own = `key:${principal}:`;
  if (id.startsWith("key:") && !(id.startsWith(own) && /^[0-9a-f]{32}$/.test(id.slice(own.length)))) {
    throw new BoardError("invalid_request", `id: key:… IDs derive from a client's key, and this one's are ${own}…`);
  }
}

export function checkMessageText(text: string, hasAttachments = false) {
  if (!hasAttachments && text.trim().length === 0)
    throw new BoardError("invalid_request", "text: message text is empty");
  if (!storable(text)) {
    throw new BoardError("invalid_request", "text: message text has a NUL character or a lone surrogate");
  }
}

/** Refuses a post the board cannot take, before anything is read for it. */
export function checkPost(command: PostCommand, by: Author) {
  if (command.id !== undefined) checkClientId(command.id, by.principal);
  if ((command.channel === undefined) === (command.re === undefined)) {
    throw new BoardError("invalid_request", "channel: a post needs channel and a reply needs re, never both");
  }
  if (command.after !== undefined && command.re === undefined) {
    throw new BoardError("invalid_after", "after: `after` is for replies");
  }
  checkMessageText(command.text, !!command.attachments?.length);
  checkLabels(command.labels ?? {});
  if (!command.sync?.length) return;
  if (command.re !== undefined) {
    throw new BoardError("invalid_request", "sync: only a new thread can name sync targets");
  }
  if (command.noSync) {
    throw new BoardError("invalid_request", "sync: noSync and sync contradict each other");
  }
  const { sync: _, ...post } = command;
  throw new BoardError("invalid_target", "This board syncs nowhere.", {
    next: [{ kind: "call", operation: "post", input: { ...post, noSync: true } }],
  });
}

/** The message a `message.posted` event shows: what its fold stores as the message's view. */
export function messageView(event: MessagePosted): Message {
  const { payload } = event;
  return {
    id: formatId(event.id),
    channel: payload.channel,
    text: payload.text,
    ...(payload.mentions === undefined ? {} : { mentions: payload.mentions }),
    re: payload.re,
    replyTo: payload.replyTo,
    thread: payload.thread,
    labels: { ...payload.labels },
    reactions: {},
    by: payload.by,
    noSync: payload.noSync,
    origin: null,
    from: null,
    createdAt: isoTime(event.at),
    editedAt: null,
    deleted: false,
    undelivered: {},
    attachments: [...payload.attachments],
    links: [],
    version: event.id,
    revision: 1,
    author: payload.author ?? null,
    blocks: payload.blocks ?? [],
  };
}

/**
 * Where a post lands: a new thread in its channel, or the thread of the message `re` names. Threads are one level
 * deep: a reply to a reply joins the root's thread, and keeps the message it answered as `replyTo`.
 */
function placePost(state: PostState, command: PostCommand, id: number) {
  if (command.channel !== undefined) return { channel: command.channel, root: id, re: null, replyTo: null };
  const target = state.target;
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${command.re}.`);
  const replyTo = target.id === target.thread ? null : formatId(target.id);
  return { channel: target.channel, root: target.thread, re: formatId(target.thread), replyTo };
}

/**
 * Refuses a reply whose `after` is not its thread's newest message any more (upstream `03-http.md` "Posting"): a
 * message that came after it, deleted or not, is `newer_message`, with the read of what came after as the way out.
 */
function checkAfter(state: PostState, command: PostCommand, root: number) {
  if (command.after === undefined) return;
  const after = state.after;
  if (!after || after.thread !== root) {
    throw new BoardError("invalid_after", `after: #${command.after} is no message in #${formatId(root)}'s thread`);
  }
  if (after.newer === null) return;
  const id = formatId(after.id);
  throw new BoardError("newer_message", `#${formatId(after.newer)} came after #${id}`, {
    hint: `Read what came after #${id}, then reply after the newest message.`,
    next: [{ kind: "run", argv: ["ob", "read", formatId(root), "--after", id] }],
  });
}

/**
 * Decides a post: the next log position names the message, after the writer's `actor.seen` when it has one. A new
 * thread is named by it too; a reply joins the thread of its root, in the root's channel.
 */
export function decidePost(state: PostState, command: PostCommand, context: PostContext, settled?: SettledMentions) {
  checkPost(command, context.by);
  const seen = actorSeen(state.actor, context, state.head + 1);
  const id = state.head + (seen ? 2 : 1);
  const { channel, root, re, replyTo } = placePost(state, command, id);
  checkAfter(state, command, root);
  const event: MessagePosted = {
    id,
    type: "message.posted",
    at: context.now,
    thread: root,
    message: id,
    channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: {
      channel,
      text: settled?.text ?? command.text,
      ...(settled?.mentions.length ? { mentions: settled.mentions } : {}),
      ...(context.blocks?.length ? { blocks: context.blocks } : {}),
      re,
      replyTo,
      thread: formatId(root),
      labels: { ...command.labels },
      noSync: command.noSync ?? false,
      by: context.by,
      ...(context.author === undefined ? {} : { author: context.author }),
      ...(command.id === undefined ? {} : { clientId: command.id }),
      origin: null,
      from: null,
      attachments: context.attachments ?? [],
      links: [],
    },
  };
  return { events: seen ? ([seen, event] as const) : ([event] as const), message: messageView(event) };
}

/**
 * A retry of a post: null when its `id` landed nothing yet, so it posts; otherwise the message that landed, as the
 * board holds it now. The same ID from another author, or for another channel, thread or reply, is `duplicate_id`
 * (upstream `03-http.md` "Posting"). Text and labels may differ: a retry gets back what landed.
 */
export function replayPost(state: PostState, command: PostCommand, context: PostContext): Message | null {
  checkPost(command, context.by);
  const landed = state.landed;
  if (command.id === undefined || !landed) return null;
  const place = placePost(state, command, 0); // Its root position is never compared: a landed post has its own.
  const { by } = context;
  const sameAuthor =
    landed.by.actor === by.actor && landed.by.principal === by.principal && landed.by.profile === by.profile;
  const samePlace = landed.channel === place.channel && landed.re === place.re && landed.replyTo === place.replyTo;
  if (!sameAuthor || !samePlace) {
    throw new BoardError("duplicate_id", `id: ${command.id} was already used for a different post`);
  }
  return landed;
}

/**
 * The `actor.seen` a write by `context.author` carries at log position `id`, or null when the board's record shows
 * that actor as it is. As upstream, it precedes the write's own event, so the feed knows an actor before its post.
 */
export function actorSeen(known: Actor | null | undefined, context: PostContext, id: number): ActorSeen | null {
  const author = context.author;
  if (!author || known === undefined) return null;
  const same =
    known?.id === context.by.actor &&
    known.kind === author.kind &&
    known.handle === author.handle &&
    known.name === author.name &&
    known.avatar === author.avatar &&
    known.via?.name === author.via?.name &&
    known.via?.environment === author.via?.environment;
  if (same) return null;
  return {
    id,
    type: "actor.seen",
    at: context.now,
    thread: null,
    message: null,
    channel: null,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 1,
    payload: { actor: context.by.actor, ...author },
  };
}
