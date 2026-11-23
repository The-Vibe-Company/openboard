import { type Author, BoardError, type Message } from "@openboard/contract";
import { formatId, isoTime } from "../ids.ts";

/** A new thread, as `POST /messages` asks for it once the contract has validated its shape. */
export interface PostCommand {
  readonly channel: string;
  readonly text: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly noSync?: boolean;
}

/** Upstream's `message.posted` payload for a root (upstream `03-http.md` "Event types"). */
export interface MessagePostedPayload {
  readonly channel: string;
  readonly text: string;
  readonly re: null;
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

/** What the board holds when a post is decided: its log head, read under the board's lock. */
export interface PostState {
  readonly head: number;
}

export interface PostContext {
  readonly by: Author;
  readonly now: number;
}

/** No board string holds a NUL, which Postgres cannot store, or a lone surrogate (upstream `storable`). */
const storable = (value: string) => !value.includes("\0") && value.isWellFormed();
const RESERVED_LABEL_PREFIX = "board.";

function checkCommand(command: PostCommand) {
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
    re: null,
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

/** Decides a post that starts a thread: the next log position names the message and its thread. */
export function decidePost(state: PostState, command: PostCommand, context: PostContext) {
  checkCommand(command);
  const id = state.head + 1;
  const event: MessagePosted = {
    id,
    type: "message.posted",
    at: context.now,
    thread: id,
    message: id,
    channel: command.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: {
      channel: command.channel,
      text: command.text,
      re: null,
      replyTo: null,
      thread: formatId(id),
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
