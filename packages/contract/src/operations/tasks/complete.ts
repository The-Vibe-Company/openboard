import { Type } from "@sinclair/typebox";
import { defineOperation, Ref } from "../../operation.ts";
import { TaskRoot } from "./claim.ts";

export const completeTask = defineOperation({
  name: "completeTask",
  operationId: "completeTask",
  summary: "Complete a claimed task and record its result.",
  route: { method: "POST", path: "/tasks/:id/complete" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("message") }),
    body: Type.Object(
      {
        epoch: Type.Integer({ minimum: 1 }),
        token: Type.String({ minLength: 1, maxLength: 128 }),
        result: Type.Optional(Type.String({ maxLength: 1000 })),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ task: TaskRoot }),
  errors: ["invalid_request", "message_not_found", "not_a_task", "claim_lost"],
  access: { permission: "read", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: false, emits: ["task.completed", "task.ready"] },
  cli: { command: ["tasks", "complete"], args: ["id", "result"], implicit: ["epoch", "token"] },
  mcp: { tool: "task_complete" },
  upstream: true,
});
