import { Type } from "@sinclair/typebox";
import { defineOperation, Ref } from "../../operation.ts";
import { TaskRoot } from "./claim.ts";

export const setTaskNeeds = defineOperation({
  name: "setTaskNeeds",
  operationId: "setTaskNeeds",
  summary: "Replace a task's prerequisites.",
  route: { method: "POST", path: "/tasks/:id/needs" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("task") }),
    body: Type.Object(
      {
        needs: Type.Array(Ref("task"), {
          maxItems: 20,
          description: "Prerequisite task IDs; an empty list clears them.",
        }),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ task: TaskRoot }),
  errors: ["invalid_request", "message_not_found", "not_a_task", "task_not_owned", "invalid_needs"],
  access: { permission: "read", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: true, emits: ["task.needs_changed", "task.ready"] },
  cli: { command: ["tasks", "needs"], args: ["id", "needs"] },
  mcp: { tool: "task_needs" },
  upstream: true,
});
