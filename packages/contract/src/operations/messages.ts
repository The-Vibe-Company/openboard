import { Type } from "@sinclair/typebox";
import { ATTACHMENT_ID_PATTERN } from "../entities/attachments/index.ts";
import { ChannelPath, LabelKey, Labels, MESSAGE_TEXT_MAX, Mention, Message } from "../entities/messages.ts";
import { defineOperation, Ref } from "../operation.ts";

const ExternalTarget = Type.String({ minLength: 3, maxLength: 300 });

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
        text: Type.Optional(
          Type.String({
            maxLength: MESSAGE_TEXT_MAX,
            default: "",
            description: "Message text, which may be empty when the message has attachments.",
          }),
        ),
        attachments: Type.Optional(
          Type.Array(Ref("file", { pattern: ATTACHMENT_ID_PATTERN.source }), { maxItems: 10 }),
        ),
        labels: Type.Optional(Labels),
        noSync: Type.Optional(Type.Boolean()),
        sync: Type.Optional(
          Type.Array(
            Type.Union([
              ExternalTarget,
              Type.Object({
                target: ExternalTarget,
                kind: Type.Union([Type.Literal("channel"), Type.Literal("thread")]),
              }),
            ]),
            { maxItems: 10, description: "External targets for a new thread. This board refuses any targets." },
          ),
        ),
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
  output: Type.Object({ message: Message, mentions: Type.Optional(Type.Array(Mention)) }),
  status: 201,
  errors: [
    "invalid_request",
    "invalid_block",
    "attachment_not_found",
    "schema_not_found",
    "invalid_after",
    "invalid_target",
    "reserved_label",
    "message_not_found",
    "duplicate_id",
    "newer_message",
    "quota_exceeded",
  ],
  access: { permission: "post", channel: "fromInput" },
  effects: { readOnly: false, idempotent: false, emits: ["message.posted"], meter: "messages" },
  cli: {
    command: ["post"],
    args: ["channel", "text"],
    options: { attachments: "attach", id: "idempotency-key", noSync: "no-sync", labels: "label" },
  },
  mcp: { tool: "post_message" },
  upstream: true,
});

const Revision = Type.Integer({ minimum: 0, description: "The message revision observed before editing or deleting." });

export const editMessage = defineOperation({
  name: "editMessage",
  operationId: "edit",
  summary: "Replace a message's text.",
  route: { method: "POST", path: "/messages/:id/edit" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("message") }, { additionalProperties: false }),
    body: Type.Object(
      { text: Type.String({ maxLength: MESSAGE_TEXT_MAX }), revision: Type.Optional(Revision) },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ ok: Type.Literal(true), mentions: Type.Optional(Type.Array(Mention)) }),
  errors: [
    "invalid_request",
    "invalid_block",
    "schema_not_found",
    "message_not_found",
    "message_deleted",
    "forbidden",
    "revision_conflict",
    "quota_exceeded",
  ],
  access: { permission: "post", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: false, emits: ["message.edited", "task.blocked"] },
  cli: { command: ["edit"], args: ["id", "text"], options: { revision: "if-revision" } },
  mcp: { tool: "edit_message" },
  upstream: true,
});

export const deleteMessage = defineOperation({
  name: "deleteMessage",
  operationId: "delete",
  summary: "Delete your message, leaving a tombstone in its thread.",
  route: { method: "POST", path: "/messages/:id/delete" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("message") }, { additionalProperties: false }),
    body: Type.Object({ revision: Type.Optional(Revision) }, { additionalProperties: false }),
  },
  output: Type.Object({ ok: Type.Literal(true) }),
  errors: ["invalid_request", "message_not_found", "forbidden", "revision_conflict"],
  access: { permission: "post", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: true, emits: ["message.deleted", "task.canceled"] },
  cli: { command: ["delete"], args: ["id"], options: { revision: "if-revision" } },
  mcp: { tool: "delete_message" },
  upstream: true,
});

const Emoji = Type.String({
  pattern: "^[a-z0-9_+-]+$",
  maxLength: 64,
  description: "A short name as Chat SDK names it: `eyes`, `thumbs_up`.",
});

export const reactToMessage = defineOperation({
  name: "reactToMessage",
  operationId: "react",
  summary: "Add or remove your emoji reaction to a message.",
  route: { method: "POST", path: "/messages/:id/reactions" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("message") }, { additionalProperties: false }),
    body: Type.Object({ emoji: Emoji, remove: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  },
  output: Type.Object({ ok: Type.Literal(true) }),
  errors: ["invalid_request", "message_not_found", "message_deleted"],
  access: { permission: "react", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: true, emits: ["reaction.added", "reaction.removed"] },
  cli: { command: ["react"], args: ["id", "emoji"], options: { remove: "remove" } },
  mcp: { tool: "react_to_message" },
  upstream: true,
});

export const labelMessage = defineOperation({
  name: "labelMessage",
  operationId: "label",
  summary: "Set and unset labels on a message if all label conditions hold; unset applies last.",
  route: { method: "POST", path: "/messages/:id/labels" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("message") }, { additionalProperties: false }),
    body: Type.Object(
      {
        set: Type.Optional(Labels),
        unset: Type.Optional(Type.Array(LabelKey)),
        if: Type.Optional(
          Type.Record(LabelKey, Type.Union([Type.String({ maxLength: 256 }), Type.Null()]), {
            additionalProperties: false,
            maxProperties: 16,
            description: "Required current label values, or null for labels that must be absent.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ ok: Type.Literal(true) }),
  errors: ["invalid_request", "reserved_label", "message_not_found", "message_deleted", "label_conflict"],
  access: { permission: "label", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: true, emits: ["labels.changed"] },
  cli: { command: ["label"], args: ["id", "set"], nullEntryOptions: { "if-unset": "if" } },
  mcp: { tool: "label_message" },
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
