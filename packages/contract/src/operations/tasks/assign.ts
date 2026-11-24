import { Type } from "@sinclair/typebox";
import { defineOperation, Ref } from "../../operation.ts";
import { TaskRoot } from "./claim.ts";

export const TaskAssignee = Type.Union([Type.String({ minLength: 1 }), Type.Null()], {
  description: "The task owner's profile actor ID, or null for the pool.",
});

export const assignTask = defineOperation({
  name: "assignTask",
  operationId: "assignTask",
  summary: "Assign a task to a profile of its owner or return it to the pool.",
  route: { method: "POST", path: "/tasks/:id/assign" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("task") }),
    body: Type.Object({ for: TaskAssignee }, { additionalProperties: false }),
  },
  output: Type.Object({ task: TaskRoot }),
  errors: ["invalid_request", "message_not_found", "not_a_task", "task_not_owned", "task_finished"],
  access: { permission: "read", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: true, emits: ["task.expired", "task.assigned"] },
  cli: { command: ["tasks", "assign"], args: ["id", "for"] },
  mcp: { tool: "task_assign" },
  upstream: true,
});
