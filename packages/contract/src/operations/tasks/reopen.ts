import { Type } from "@sinclair/typebox";
import { defineOperation, Ref } from "../../operation.ts";
import { TaskRoot } from "./claim.ts";

export const reopenTask = defineOperation({
  name: "reopenTask",
  operationId: "reopenTask",
  summary: "Reopen a failed task.",
  route: { method: "POST", path: "/tasks/:id/reopen" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("message") }),
  },
  output: Type.Object({
    task: TaskRoot,
    outcome: Type.Optional(Type.Union([Type.Literal("reopened"), Type.Literal("unchanged")])),
  }),
  errors: ["invalid_request", "message_not_found", "not_a_task", "task_not_owned", "task_finished"],
  access: { permission: "read", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: true, emits: ["task.reopened"] },
  cli: { command: ["tasks", "reopen"], args: ["id"] },
  mcp: { tool: "task_reopen" },
  upstream: true,
});
