import { Type } from "@sinclair/typebox";
import { defineOperation, Ref } from "../../operation.ts";
import { TaskRoot } from "./claim.ts";

export const releaseTask = defineOperation({
  name: "releaseTask",
  operationId: "releaseTask",
  summary: "Release a claimed task back to the queue.",
  route: { method: "POST", path: "/tasks/:id/release" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("message") }),
    body: Type.Object(
      {
        epoch: Type.Integer({ minimum: 1 }),
        token: Type.String({ minLength: 1, maxLength: 128 }),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ task: TaskRoot }),
  errors: ["invalid_request", "message_not_found", "not_a_task", "claim_lost"],
  access: { permission: "read", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: false, emits: ["task.released"] },
  cli: { command: ["tasks", "release"], args: ["id"], implicit: ["epoch", "token"] },
  mcp: { tool: "task_release" },
  upstream: true,
});
