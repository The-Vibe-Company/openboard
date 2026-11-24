import { Type } from "@sinclair/typebox";
import { CHANNEL_PATH_MAX, ChannelPath } from "../entities/messages.ts";

/** A channel by its whole name, or with a trailing slash (`dev/`) the channel and every channel under it (upstream "Filters"). */
export const ChannelFilter = Type.String({
  maxLength: CHANNEL_PATH_MAX + 1,
  pattern: String(ChannelPath.pattern).replace(/\$$/, "/?$"),
  description: "A channel by its whole name, or `dev/` for `dev` and every channel under it.",
});

export const messageFilters = {
  by: Type.Optional(
    Type.String({
      pattern: "^[^\\u0000]+$",
      description: "A message by this handle, actor ID, or `me` for the caller's actor.",
    }),
  ),
  mentions: Type.Optional(
    Type.String({
      pattern: "^(?!@?$)[^\\u0000]+$",
      description:
        "A message mentioning this handle (`@` optional), actor ID (`@[id]`), or `me`; a person's covers their agents.",
    }),
  ),
  label: Type.Optional(Type.Array(Type.String({ pattern: "^[a-z0-9][a-z0-9_.-]*(=.*)?$" }))),
  text: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "^[^\\u0000]+$",
      description: "A case-insensitive substring of the message text; `%` and `_` match only themselves.",
    }),
  ),
};
