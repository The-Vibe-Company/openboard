import { Type } from "@sinclair/typebox";
import { AttachmentIds } from "../../entities/attachments/index.ts";
import { ChannelPath, Labels, MESSAGE_TEXT_MAX } from "../../entities/messages.ts";
import { defineOperation, Ref } from "../../operation.ts";

import { TaskAssignee } from "./assign.ts";
import { TaskClaim, TaskLease, TaskRoot } from "./claim.ts";

export const createTask = defineOperation({
  name: "createTask",
  operationId: "createTask",
  summary: "Start a thread as a task, or make a task of the thread `re` roots.",
  route: { method: "POST", path: "/tasks" },
  scope: "board",
  input: {
    body: Type.Object(
      {
        channel: Type.Optional(ChannelPath),
        text: Type.Optional(Type.String({ maxLength: MESSAGE_TEXT_MAX })),
        re: Type.Optional(
          Ref("message", { description: "The root of a thread to make a task of as it is, instead of a new thread." }),
        ),
        for: Type.Optional(TaskAssignee),
        needs: Type.Optional(Type.Array(Ref("task"), { maxItems: 20 })),
        labels: Type.Optional(Labels),
        attachments: Type.Optional(AttachmentIds),
        claim: Type.Optional(Type.Boolean({ description: "Claim the task in the same write." })),
        lease: TaskLease,
        noSync: Type.Optional(Type.Boolean()),
        id: Type.Optional(
          Type.String({ minLength: 1, maxLength: 200, description: "An idempotency key for a new task thread." }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ task: TaskRoot, claim: Type.Optional(TaskClaim) }),
  status: 201,
  errors: [
    "quota_exceeded",
    "invalid_request",
    "attachment_not_found",
    "invalid_needs",
    "task_waiting",
    "task_assigned",
    "reserved_label",
    "forbidden",
    "message_not_found",
    "message_deleted",
    "already_a_task",
    "duplicate_id",
  ],
  access: { permission: "post", channel: "fromInput", re: "label" },
  effects: {
    readOnly: false,
    idempotent: false,
    emits: ["message.posted", "task.created", "task.ready", "task.claimed"],
    meter: "messages",
  },
  cli: {
    command: ["tasks", "create"],
    args: ["channel", "text"],
    alternative: ["re"],
    options: { attachments: "attach", id: "idempotency-key", labels: "label", noSync: "no-sync", claim: "claim" },
  },
  mcp: { tool: "task_create" },
  upstream: true,
});
