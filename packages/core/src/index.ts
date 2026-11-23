import type { ChannelCreated } from "./channels/create.ts";
import type { MessagePosted } from "./messages/post.ts";

export * as channels from "./channels/create.ts";
export type { ChannelCreated };
export type BoardEvent = ChannelCreated | MessagePosted;
export { formatId, isoTime, parseId } from "./ids.ts";
export type { MessagePosted, MessagePostedPayload, PostCommand } from "./messages/post.ts";
export * as messages from "./messages/post.ts";
