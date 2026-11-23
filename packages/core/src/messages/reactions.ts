import { type Author, BoardError, type Message } from "@openboard/contract";
import { parseId } from "../ids.ts";
import { type ActorSeen, actorSeen, type PostContext, type PostState } from "./post.ts";

export interface ReactionAdded {
  readonly id: number;
  readonly type: "reaction.added";
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
    readonly emoji: string;
    readonly by: Author;
    readonly from: null;
    /** Internal projection as of this event, for folding and reading the feed from a cursor. */
    readonly view: Message;
  };
}

/** Upstream's emoji value rule (`03-http.md` "Event types"): a short name, never a name every object has. */
const EMOJI = /^[a-z0-9_+-]{1,64}$/;
const RESERVED = new Set(["constructor", "__proto__", "prototype"]);

/** Other platforms' names for upstream's canonical Chat SDK names (upstream `emoji-table.ts`): `+1` is stored `thumbs_up`. */
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "+1": "thumbs_up",
  thumbsup: "thumbs_up",
  "-1": "thumbs_down",
  thumbsdown: "thumbs_down",
  slightly_smiling_face: "smile",
  laughing: "laugh",
  satisfied: "laugh",
  joy: "laugh",
  thinking_face: "thinking",
  white_frowning_face: "sad",
  sob: "cry",
  heart_eyes: "love_eyes",
  sunglasses: "cool",
  open_mouth: "surprised",
  neutral_face: "neutral",
  nauseated_face: "sick",
  exploding_head: "mind_blown",
  grimacing: "grimace",
  hugging_face: "hug",
  zany_face: "zany",
  white_check_mark: "check",
  heavy_check_mark: "check",
  heavy_multiplication_x: "x",
  octagonal_sign: "stop",
  information_source: "info",
  zap: "lightning",
  large_green_circle: "green_circle",
  large_yellow_circle: "yellow_circle",
  large_blue_circle: "blue_circle",
  tada: "party",
  partying_face: "party",
  confetti_ball: "confetti",
  first_place_medal: "medal",
  bulb: "lightbulb",
  pushpin: "pin",
  clock1: "clock",
  mega: "megaphone",
  speech_balloon: "speech_bubble",
  inbox_tray: "inbox",
  outbox_tray: "outbox",
  file_folder: "folder",
  page_facing_up: "file",
  chart_with_upwards_trend: "chart_up",
  chart_with_downwards_trend: "chart_down",
  arrows_counterclockwise: "refresh",
  sunny: "sun",
  rain_cloud: "rain",
  snowflake: "snow",
});

/** A valid short name in its canonical form; anything else is a 400. Unknown names are their own. */
export function canonicalEmoji(emoji: string): string {
  if (!EMOJI.test(emoji) || RESERVED.has(emoji)) {
    throw new BoardError("invalid_request", `emoji: expected a short name like eyes or thumbs_up, got ${emoji}`);
  }
  return Object.hasOwn(ALIASES, emoji) ? (ALIASES[emoji] as string) : emoji;
}

/** What the board holds when a reaction is decided, read under the board's lock. */
export interface ReactionState {
  readonly head: number;
  readonly target: Message | null;
  /** The board's record of the writer: null when it has none; left out, the write records no `actor.seen`. */
  readonly actor?: PostState["actor"];
}

/**
 * Decides a reaction: the writer's actor ID joins the emoji's list on the message, after the writer's `actor.seen`
 * when it has one. A reaction the writer already holds appends no reaction event.
 */
export function decideReaction(
  { head, target, actor }: ReactionState,
  { id, emoji }: { readonly id: string; readonly emoji: string },
  context: PostContext,
): readonly (ActorSeen | ReactionAdded)[] {
  const name = canonicalEmoji(emoji);
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  if (target.deleted) throw new BoardError("message_deleted", `Message #${id} is deleted.`);
  const { by, now } = context;
  const seen = actorSeen(actor, context, head + 1);
  const held = Object.hasOwn(target.reactions, name) ? (target.reactions[name] ?? []) : [];
  if (held.includes(by.actor)) return seen ? [seen] : [];
  const message = parseId(target.id);
  const thread = parseId(target.thread);
  if (message === null || thread === null) throw new Error("invalid stored message or thread position");
  const version = head + (seen ? 2 : 1);
  const reactions = { ...target.reactions, [name]: [...held, by.actor] };
  const event: ReactionAdded = {
    id: version,
    type: "reaction.added",
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
      emoji: name,
      by,
      from: null,
      view: { ...target, reactions, version },
    },
  };
  return seen ? [seen, event] : [event];
}
