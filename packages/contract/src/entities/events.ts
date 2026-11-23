import { Type } from "@sinclair/typebox";
import { Author, ChannelPath, Labels, Message } from "./messages.ts";

const MessagePostedPayload = Type.Object({
  channel: ChannelPath,
  text: Type.String(),
  re: Type.Union([Type.String(), Type.Null()]),
  replyTo: Type.Union([Type.String(), Type.Null()]),
  thread: Type.String(),
  labels: Labels,
  noSync: Type.Boolean(),
  by: Author,
  origin: Type.Null(),
  from: Type.Null(),
  attachments: Type.Array(Type.Unknown()),
  links: Type.Array(Type.Unknown()),
});

const PostedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("message.posted"),
  createdAt: Type.String(),
  payload: MessagePostedPayload,
  message: Message,
});

const EditedEvent = Type.Object({
  cursor: Type.String(),
  type: Type.Literal("message.edited"),
  createdAt: Type.String(),
  payload: Type.Object({
    id: Type.String(),
    text: Type.String(),
    by: Author,
    from: Type.Null(),
  }),
  message: Message,
});

export const Event = Type.Union([PostedEvent, EditedEvent]);
