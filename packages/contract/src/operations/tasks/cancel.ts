import { Type } from "@sinclair/typebox";
import { defineOperation, Ref } from "../../operation.ts";
import { TaskRoot } from "./claim.ts";

export const cancelTask = defineOperation({
  name: "cancelTask",
  operationId: "cancelTask",
  summary: "Cancel an unfinished task and record the reason.",
  route: { method: "POST", path: "/tasks/:id/cancel" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("message") }),
    body: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }),
  },
  output: Type.Object({ task: TaskRoot }),
  errors: ["invalid_request", "message_not_found", "not_a_task", "task_not_owned", "task_finished"],
  access: { permission: "read", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: false, emits: ["task.canceled"] },
  cli: { command: ["tasks", "cancel"], args: ["id", "reason"] },
  mcp: { tool: "task_cancel" },
  upstream: true,
});
