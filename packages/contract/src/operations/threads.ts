import { Type } from "@sinclair/typebox";
import { Thread } from "../entities/threads.ts";
import { defineOperation, Ref } from "../operation.ts";

export const readThread = defineOperation({
  name: "readThread",
  operationId: "message",
  summary: "Read one message as a thread: the message, then its replies, oldest first.",
  route: { method: "GET", path: "/messages/:id" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("message") }, { additionalProperties: false }),
  },
  output: Thread,
  errors: ["message_not_found"],
  access: { permission: "read", channel: "fromMessage" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: { tool: "read_thread" },
  why: "`ob read <id>` is hand-written: it shares `ob read` with channels and prints one line per message.",
  upstream: true,
});
