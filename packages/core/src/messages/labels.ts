import { type Actor, type Author, BoardError, type Message } from "@openboard/contract";
import { parseId } from "../ids.ts";
import { type ActorSeen, actorSeen, type PostContext } from "./post.ts";

/** Keys under it are the board's own: no client write sets or unsets one (upstream `03-http.md` "Tasks"). */
const RESERVED_LABEL_PREFIX = "board.";
/** Upstream's label key rule (`03-http.md` value table): up to 64 characters, never a name every object has. */
const KEY = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const OBJECT_KEYS = new Set(["constructor", "prototype"]);
const LABEL_VALUE_MAX = 256;

/** Refuses a label key a write cannot set: a malformed one, `constructor` or `prototype`, or one under `board.`. */
export function checkLabelKey(key: string) {
  if (!KEY.test(key) || OBJECT_KEYS.has(key)) {
    throw new BoardError(
      "invalid_request",
      `labels.${key}: a label key is 1 to 64 of a-z, 0-9, ".", "_" and "-", starts with a letter or digit, and is not constructor or prototype`,
    );
  }
  if (key.startsWith(RESERVED_LABEL_PREFIX)) {
    throw new BoardError("reserved_label", `labels.${key}: the board writes labels under ${RESERVED_LABEL_PREFIX}`);
  }
}

/** Refuses a label value the board cannot keep: over 256 characters, a control character, or a lone surrogate. */
export function checkLabelValue(key: string, value: string) {
  if (value.length > LABEL_VALUE_MAX) {
    throw new BoardError("invalid_request", `labels.${key}: a label value is up to ${LABEL_VALUE_MAX} characters`);
  }
  if (/\p{Cc}/u.test(value) || !value.isWellFormed()) {
    throw new BoardError("invalid_request", `labels.${key}: label value has a control character or a lone surrogate`);
  }
}

/** Refuses labels a write cannot set, by upstream's value table; each key holds one value. */
export function checkLabels(labels: Readonly<Record<string, string>>) {
  for (const [key, value] of Object.entries(labels)) {
    checkLabelKey(key);
    checkLabelValue(key, value);
  }
}

export interface LabelsChanged {
  readonly id: number;
  readonly type: "labels.changed";
  readonly at: number;
  readonly thread: number;
  readonly message: number;
  readonly channel: string;
  readonly actor: string;
  readonly principal: string;
  readonly visibility: 0;
  readonly payload: {
    readonly id: string;
    readonly thread: string;
    readonly set: Readonly<Record<string, string>>;
    readonly unset: readonly string[];
    readonly by: Author;
    /** Internal projection as of this event, for folding and reading the feed from a cursor. */
    readonly view: Message;
  };
}

/** What the board holds when a label write is decided, read under the board's lock. */
export interface LabelState {
  readonly head: number;
  readonly target: Message | null;
  /** The board's record of the writer: null when it has none; left out, the write records no `actor.seen`. */
  readonly actor?: Actor | null;
}

/**
 * Sets labels on a message, each key to one value, and raises its version; a write that changes no value still appends
 * its event, as upstream's does. It follows the writer's `actor.seen` when needed.
 */
export function decideLabels(
  { head, target, actor }: LabelState,
  { id, set }: { readonly id: string; readonly set: Readonly<Record<string, string>> },
  context: PostContext,
): readonly (ActorSeen | LabelsChanged)[] {
  checkLabels(set);
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  if (target.deleted) throw new BoardError("message_deleted", `Message #${id} is deleted.`);
  const message = parseId(target.id);
  const thread = parseId(target.thread);
  if (message === null || thread === null) throw new Error("invalid stored message or thread position");
  const seen = actorSeen(actor, context, head + 1);
  const version = head + (seen ? 2 : 1);
  const { by, now } = context;
  const event: LabelsChanged = {
    id: version,
    type: "labels.changed",
    at: now,
    thread,
    message,
    channel: target.channel,
    actor: by.actor,
    principal: by.principal,
    visibility: 0,
    payload: {
      id: target.id,
      thread: target.thread,
      set: { ...set },
      unset: [],
      by,
      view: { ...target, labels: { ...target.labels, ...set }, version },
    },
  };
  return seen ? [seen, event] : [event];
}
