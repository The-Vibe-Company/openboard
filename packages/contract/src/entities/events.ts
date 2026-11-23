import { Type } from "@sinclair/typebox";
import { Author, ChannelPath, Labels, Message } from "./messages.ts";

const MessagePostedPayload = Type.Object({
  channel: ChannelPath,
  text: Type.String(),
  re: Type.Null(),
  replyTo: Type.Null(),
  thread: Type.String(),
  labels: Labels,
  noSync: Type.Boolean(),
  by: Author,
  origin: Type.Null(),
  from: Type.Null(),
  attachments: Type.Array(Type.Unknown()),
  links: Type.Array(Type.Unknown()),
});

export const Event = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("message.posted"),
  createdAt: Type.String(),
  payload: MessagePostedPayload,
  message: Message,
});
