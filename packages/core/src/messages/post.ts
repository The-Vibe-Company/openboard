import { type Actor, type Author, BoardError, type Message, type MessageAuthor } from "@openboard/contract";
import { formatId, isoTime } from "../ids.ts";

/** A new thread (`channel`) or a reply (`re`), as `POST /messages` asks for it once the contract has validated it. */
export interface PostCommand {
  readonly channel?: string;
  readonly re?: string;
  readonly text: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly noSync?: boolean;
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
  readonly labels: Readonly<Record<string, string>>;
  readonly noSync: boolean;
  readonly by: Author;
  /** Who wrote it, for people to read; the server resolves it from the credential. Not part of upstream's payload. */
  readonly author?: MessageAuthor;
  readonly origin: null;
  readonly from: null;
  readonly attachments: readonly never[];
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
}

export interface PostContext {
  readonly by: Author;
  /** How the writer shows; with `state.actor` read, the post records it with `actor.seen` unless that matches it. */
  readonly author?: MessageAuthor;
  readonly now: number;
}

/** No board string holds a NUL, which Postgres cannot store, or a lone surrogate (upstream `storable`). */
const storable = (value: string) => !value.includes("\0") && value.isWellFormed();
const RESERVED_LABEL_PREFIX = "board.";

function checkCommand(command: PostCommand) {
  if ((command.channel === undefined) === (command.re === undefined)) {
    throw new BoardError("invalid_request", "channel: a post needs channel and a reply needs re, never both");
  }
  if (command.text.trim().length === 0) throw new BoardError("invalid_request", "text: message text is empty");
  if (!storable(command.text)) {
    throw new BoardError("invalid_request", "text: message text has a NUL character or a lone surrogate");
  }
  for (const [key, value] of Object.entries(command.labels ?? {})) {
    if (key.startsWith(RESERVED_LABEL_PREFIX)) {
      throw new BoardError("reserved_label", `labels.${key}: the board writes labels under ${RESERVED_LABEL_PREFIX}`);
    }
    if (!storable(value) || /\p{Cc}/u.test(value)) {
      throw new BoardError("invalid_request", `labels.${key}: label value has a control character`);
    }
  }
}

/** The message a `message.posted` event shows: what its fold stores as the message's view. */
export function messageView(event: MessagePosted): Message {
  const { payload } = event;
  return {
    id: formatId(event.id),
    channel: payload.channel,
    text: payload.text,
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
    attachments: [],
    links: [],
    version: event.id,
    revision: 0,
    author: payload.author ?? null,
    blocks: [],
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
 * Decides a post: the next log position names the message, after the writer's `actor.seen` when it has one. A new
 * thread is named by it too; a reply joins the thread of its root, in the root's channel.
 */
export function decidePost(state: PostState, command: PostCommand, context: PostContext) {
  checkCommand(command);
  const seen = actorSeen(state.actor, context, state.head + 1);
  const id = state.head + (seen ? 2 : 1);
  const { channel, root, re, replyTo } = placePost(state, command, id);
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
      text: command.text,
      re,
      replyTo,
      thread: formatId(root),
      labels: { ...command.labels },
      noSync: command.noSync ?? false,
      by: context.by,
      ...(context.author === undefined ? {} : { author: context.author }),
      origin: null,
      from: null,
      attachments: [],
      links: [],
    },
  };
  return { events: seen ? ([seen, event] as const) : ([event] as const), message: messageView(event) };
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
