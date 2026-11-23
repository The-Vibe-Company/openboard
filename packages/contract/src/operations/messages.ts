import { Type } from "@sinclair/typebox";
import { ChannelPath, Labels, MESSAGE_TEXT_MAX, Message } from "../entities/messages.ts";
import { defineOperation, Ref } from "../operation.ts";

export const postMessage = defineOperation({
  name: "postMessage",
  operationId: "post",
  summary: "Post a message: a new thread in a channel, or a reply in the thread of any message `re` names.",
  route: { method: "POST", path: "/messages" },
  scope: "board",
  input: {
    body: Type.Object(
      {
        channel: Type.Optional(ChannelPath),
        re: Type.Optional(Ref("message")),
        text: Type.String({ maxLength: MESSAGE_TEXT_MAX }),
        labels: Type.Optional(Labels),
        noSync: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ message: Message }),
  status: 201,
  errors: ["invalid_request", "reserved_label", "message_not_found"],
  access: { permission: "post", channel: "fromInput" },
  effects: { readOnly: false, idempotent: false, emits: ["message.posted"], meter: "messages" },
  cli: { command: ["post"], args: ["channel", "text"] },
  mcp: { tool: "post_message" },
  upstream: true,
});

export const listMessages = defineOperation({
  name: "listMessages",
  operationId: "channelMessages",
  summary:
    "Read one channel's messages, oldest first: the first `limit` after the cursor `after`, or the latest `limit`.",
  route: { method: "GET", path: "/messages" },
  scope: "board",
  input: {
    query: Type.Object(
      {
        channel: ChannelPath,
        after: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50 })),
      },
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
