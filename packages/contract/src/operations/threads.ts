import { Type } from "@sinclair/typebox";
import { ChannelPath } from "../entities/messages.ts";
import { Thread, ThreadSummary } from "../entities/threads.ts";
import { defineOperation, Ref } from "../operation.ts";

export const readThread = defineOperation({
  name: "readThread",
  operationId: "message",
  summary: "Read a thread from any of its messages: the root, then the selected replies, oldest first.",
  route: { method: "GET", path: "/messages/:id" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("message") }, { additionalProperties: false }),
    query: Type.Object(
      {
        after: Type.Optional(
          Ref("message", { description: "Return replies strictly after this message in the thread." }),
        ),
        limit: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 500,
            description: "Maximum replies: the first after the cursor, or the newest.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  output: Thread,
  errors: ["message_not_found", "invalid_request"],
  access: { permission: "read", channel: "fromMessage" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: { tool: "read_thread" },
  why: "`ob read <id>` is hand-written: it shares `ob read` with channels and prints one line per message.",
  upstream: true,
});

export const listThreads = defineOperation({
  name: "listThreads",
  operationId: "threads",
  summary: "List a channel's latest threads by activity, oldest first, with reply counts and latest replies.",
  route: { method: "GET", path: "/threads" },
  scope: "board",
  input: {
    query: Type.Object(
      {
        channel: ChannelPath,
        label: Type.Optional(Type.Array(Type.String({ pattern: "^[a-z0-9][a-z0-9_.-]*(=.*)?$" }))),
        text: Type.Optional(
          Type.String({
            maxLength: 4096,
            description:
              "Only threads whose root or a reply now says this, in any case; `%` and `_` match only themselves.",
          }),
        ),
        after: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 128,
            description: "A decimal cursor or message ID: the threads active after it, the first `limit` of them.",
          }),
        ),
        before: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 128,
            description:
              "A page's `older`: the threads last active before that page's, the latest `limit` of them. Not with `after`.",
          }),
        ),
        limit: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 500,
            description: "Maximum threads, 50 by default: the latest, or with `after` the first after it.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({
    threads: Type.Array(ThreadSummary),
    cursor: Type.String(),
    older: Type.Optional(
      Type.Union([Type.String(), Type.Null()], {
        description:
          "The `before` for the next older page, as it came, or null when no thread is older. Absent with `after`.",
      }),
    ),
  }),
  errors: ["invalid_request", "invalid_cursor"],
  access: { permission: "read", channel: "fromInput" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: { tool: "list_threads" },
  why: "`ob read <channel>` is hand-written: it renders thread summaries and shares the command with message IDs.",
  upstream: true,
});
