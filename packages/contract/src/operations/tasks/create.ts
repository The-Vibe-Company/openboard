import { Type } from "@sinclair/typebox";
import { ChannelPath, Labels, MESSAGE_TEXT_MAX, Message } from "../../entities/messages.ts";
import { Task } from "../../entities/tasks.ts";
import { defineOperation } from "../../operation.ts";

export const createTask = defineOperation({
  name: "createTask",
  operationId: "createTask",
  summary: "Start a thread as a ready task.",
  route: { method: "POST", path: "/tasks" },
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
  output: Type.Object({ task: Type.Object({ ...Message.properties, task: Task }) }),
  status: 201,
  errors: ["invalid_request", "reserved_label", "forbidden"],
  access: { permission: "post", channel: "fromInput" },
  effects: { readOnly: false, idempotent: false, emits: ["message.posted", "task.created"], meter: "messages" },
  cli: { command: ["tasks", "create"], args: ["channel", "text"], options: { labels: "label", noSync: "no-sync" } },
  mcp: { tool: "task_create" },
  upstream: true,
});
