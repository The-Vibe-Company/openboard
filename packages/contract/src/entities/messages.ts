import { type Static, Type } from "@sinclair/typebox";

export const CHANNEL_PATH_MAX = 2048;
export const MESSAGE_TEXT_MAX = 10_000;
const segment = "[a-z0-9][a-z0-9_-]*";

/** `errors-www`, `www/production`: lowercase segments joined by `/` (upstream `ChannelPath`). */
export const ChannelPath = Type.String({ maxLength: CHANNEL_PATH_MAX, pattern: `^${segment}(?:/${segment})*$` });

/** Label keys as upstream takes them: 1 to 64 lowercase letters, digits, `.`, `_` and `-`. */
export const Labels = Type.Record(
  Type.String({ pattern: "^[a-z0-9][a-z0-9_.-]{0,63}$" }),
  Type.String({ maxLength: 256 }),
);

/** Who wrote a message: the actor, the principal it acts for, and the profile, if any. */
export const Author = Type.Object({
  actor: Type.String(),
  principal: Type.String(),
  profile: Type.Union([Type.String(), Type.Null()]),
});

/** A message as the board answers it (upstream `MessageView`); IDs are decimal strings. */
export const Message = Type.Object({
  id: Type.String(),
  channel: Type.String(),
  text: Type.String(),
  re: Type.Union([Type.String(), Type.Null()]),
  replyTo: Type.Union([Type.String(), Type.Null()]),
  thread: Type.String(),
  labels: Labels,
  reactions: Type.Record(Type.String(), Type.Array(Type.String())),
  by: Author,
  noSync: Type.Boolean(),
  origin: Type.Null(),
  from: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  editedAt: Type.Union([Type.String(), Type.Null()]),
  deleted: Type.Boolean(),
  undelivered: Type.Record(Type.String(), Type.String()),
  attachments: Type.Array(Type.Unknown()),
  links: Type.Array(Type.Unknown()),
  version: Type.Integer(),
  revision: Type.Integer(),
  author: Type.Null(),
  blocks: Type.Array(Type.Unknown()),
});
export type Message = Static<typeof Message>;
export type Author = Static<typeof Author>;
