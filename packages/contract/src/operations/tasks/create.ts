import { Type } from "@sinclair/typebox";
import { ChannelPath, Labels, MESSAGE_TEXT_MAX, Message } from "../../entities/messages.ts";
import { Task } from "../../entities/tasks.ts";
import { defineOperation, Ref } from "../../operation.ts";

export const createTask = defineOperation({
  name: "createTask",
  operationId: "createTask",
  summary: "Start a thread as a ready task, or make a ready task of the thread `re` roots.",
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
        labels: Type.Optional(Labels),
        noSync: Type.Optional(Type.Boolean()),
        id: Type.Optional(
          Type.String({ minLength: 1, maxLength: 200, description: "An idempotency key for a new task thread." }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ task: Type.Object({ ...Message.properties, task: Task }) }),
  status: 201,
  errors: [
    "invalid_request",
    "reserved_label",
    "forbidden",
    "message_not_found",
    "message_deleted",
    "already_a_task",
    "duplicate_id",
  ],
  access: { permission: "post", channel: "fromInput", re: "label" },
  effects: { readOnly: false, idempotent: false, emits: ["message.posted", "task.created"], meter: "messages" },
  cli: {
    command: ["tasks", "create"],
    args: ["channel", "text"],
    alternative: ["re"],
    options: { id: "idempotency-key", labels: "label", noSync: "no-sync" },
  },
  mcp: { tool: "task_create" },
  upstream: true,
});
