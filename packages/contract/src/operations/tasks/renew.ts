import { Type } from "@sinclair/typebox";
import { defineOperation, Ref } from "../../operation.ts";
import { TaskLease, TaskRoot } from "./claim.ts";

export const renewTask = defineOperation({
  name: "renewTask",
  operationId: "renewTask",
  summary: "Renew a task claim from the current time.",
  route: { method: "POST", path: "/tasks/:id/renew" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("message") }),
    body: Type.Object(
      {
        epoch: Type.Integer({ minimum: 1 }),
        token: Type.String({ minLength: 1, maxLength: 128 }),
        lease: TaskLease,
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ task: TaskRoot, until: Type.String() }),
  errors: ["invalid_request", "message_not_found", "not_a_task", "claim_lost"],
  access: { permission: "read", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: false, emits: ["task.renewed"] },
  cli: { command: ["tasks", "renew"], args: ["id"], implicit: ["epoch", "token"] },
  mcp: { tool: "task_renew" },
  upstream: true,
});
