import { type Author, BoardError, type Message } from "@openboard/contract";
import { formatId, isoTime } from "../ids.ts";

/** A new thread (`channel`) or a reply (`re`), as `POST /messages` asks for it once the contract has validated it. */
export interface PostCommand {
  readonly channel?: string;
  readonly re?: string;
  readonly text: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly noSync?: boolean;
}

/** Upstream's `message.posted` payload (upstream `03-http.md` "Event types"); `re` is the root of a reply. */
export interface MessagePostedPayload {
  readonly channel: string;
  readonly text: string;
  readonly re: string | null;
  readonly replyTo: null;
  readonly thread: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly noSync: boolean;
  readonly by: Author;
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
  /** The root it replies to, or null when it is a root itself. */
  readonly re: string | null;
}

/**
 * What the board holds when a post is decided, read under the board's lock: its log head and, for a reply, the
 * message `re` names, or null when no message has that ID.
 */
export interface PostState {
  readonly head: number;
  readonly target?: ReplyTarget | null;
}

export interface PostContext {
  readonly by: Author;
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
    replyTo: null,
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
    author: null,
    blocks: [],
  };
}

/** Where a post lands: a new thread in its channel, or the thread of the root `re` names. */
function placePost(state: PostState, command: PostCommand, id: number) {
  if (command.channel !== undefined) return { channel: command.channel, root: id, re: null };
  const target = state.target;
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${command.re}.`);
  if (target.re !== null) throw new BoardError("invalid_request", `re: message #${command.re} is a reply, not a root`);
  return { channel: target.channel, root: target.id, re: formatId(target.id) };
}

/**
 * Decides a post: the next log position names the message. A new thread is named by it too; a reply joins the
 * thread of its root, in the root's channel.
 */
export function decidePost(state: PostState, command: PostCommand, context: PostContext) {
  checkCommand(command);
  const id = state.head + 1;
  const { channel, root, re } = placePost(state, command, id);
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
      replyTo: null,
      thread: formatId(root),
      labels: { ...command.labels },
      noSync: command.noSync ?? false,
      by: context.by,
      origin: null,
      from: null,
      attachments: [],
      links: [],
    },
  };
  return { events: [event] as const, message: messageView(event) };
}
