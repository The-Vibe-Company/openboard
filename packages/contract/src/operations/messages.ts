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
        after: Type.Optional(
          Ref("message", {
            description: "A reply's precondition: a message in its thread that must still be the newest.",
          }),
        ),
        text: Type.String({ maxLength: MESSAGE_TEXT_MAX }),
        labels: Type.Optional(Labels),
        noSync: Type.Optional(Type.Boolean()),
        id: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 200,
            description:
              "An idempotency key: a retry under it gets back the post that landed instead of posting again.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ message: Message }),
  status: 201,
  errors: ["invalid_request", "invalid_after", "reserved_label", "message_not_found", "duplicate_id", "newer_message"],
  access: { permission: "post", channel: "fromInput" },
  effects: { readOnly: false, idempotent: false, emits: ["message.posted"], meter: "messages" },
  cli: { command: ["post"], args: ["channel", "text"], options: { id: "idempotency-key", noSync: "no-sync" } },
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
        after: Type.Optional(Type.String({ description: "A decimal cursor from 0 through the current board head." })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50 })),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ messages: Type.Array(Message), cursor: Type.String() }),
  errors: ["invalid_request", "invalid_cursor"],
  access: { permission: "read", channel: "fromInput" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: { tool: "list_messages" },
  why: "`ob messages <channel>` is hand-written: it prints one line per message rather than the raw page.",
  upstream: true,
});

export const readPost = defineOperation({
  name: "readPost",
  operationId: "posted",
  summary: "Read the caller's own post by its client ID, as it landed.",
  route: { method: "GET", path: "/posts/:id" },
  scope: "board",
  // Lookup accepts any path ID so one that could never land still answers post_not_found.
  input: { params: Type.Object({ id: Ref("message", { maxLength: undefined }) }, { additionalProperties: false }) },
  output: Type.Object({ message: Message }),
  errors: ["invalid_request", "post_not_found"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["posted"], args: ["id"] },
  mcp: { tool: "read_post" },
  upstream: true,
});
