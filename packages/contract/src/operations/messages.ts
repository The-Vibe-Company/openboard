import { Type } from "@sinclair/typebox";
import { ChannelPath, Labels, MESSAGE_TEXT_MAX, Message } from "../entities/messages.ts";
import { defineOperation } from "../operation.ts";

export const postMessage = defineOperation({
  name: "postMessage",
  summary: "Post a message that starts a thread in a channel.",
  route: { method: "POST", path: "/messages" },
  scope: "board",
  input: {
    body: Type.Object(
      {
        channel: ChannelPath,
        text: Type.String({ maxLength: MESSAGE_TEXT_MAX }),
        labels: Type.Optional(Labels),
        noSync: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ message: Message }),
  status: 201,
  errors: ["invalid_request"],
  access: { permission: "post", channel: "fromInput" },
  effects: { readOnly: false, idempotent: false, emits: ["message.posted"], meter: "messages" },
  cli: { command: ["post"], args: ["channel", "text"] },
  mcp: { tool: "post_message" },
  upstream: true,
});

export const listMessages = defineOperation({
  name: "listMessages",
  summary: "Read one channel's latest messages, oldest first.",
  route: { method: "GET", path: "/messages" },
  scope: "board",
  input: {
    query: Type.Object(
      { channel: ChannelPath, limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50 })) },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ messages: Type.Array(Message), cursor: Type.String() }),
  errors: ["invalid_request"],
  access: { permission: "read", channel: "fromInput" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: { tool: "list_messages" },
  why: "`ob read <channel>` is hand-written: it prints one line per message rather than the raw page.",
  upstream: true,
});
