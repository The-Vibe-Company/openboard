import { Type } from "@sinclair/typebox";
import { Message } from "../../entities/messages.ts";
import { Task } from "../../entities/tasks.ts";
import { defineOperation, Ref } from "../../operation.ts";

export const TaskLease = Type.Optional(
  Type.Integer({ minimum: 30, maximum: 3600, description: "Lease in seconds, default 900." }),
);

export const TaskRoot = Type.Object({ ...Message.properties, task: Task });
export const TaskClaim = Type.Object({
  epoch: Type.Integer({ minimum: 1 }),
  token: Type.String(),
  until: Type.String(),
});

export const claimTask = defineOperation({
  name: "claimTask",
  operationId: "claimTask",
  summary: "Claim a ready task with a lease.",
  route: { method: "POST", path: "/tasks/:id/claim" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("message") }),
    body: Type.Object(
      {
        lease: TaskLease,
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ task: TaskRoot, claim: TaskClaim }),
  errors: [
    "invalid_request",
    "message_not_found",
    "not_a_task",
    "forbidden",
    "task_claimed",
    "task_waiting",
    "task_blocked",
    "task_finished",
    "task_assigned",
  ],
  access: { permission: "label", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: false, emits: ["task.expired", "task.claimed"], meter: "task_claims" },
  cli: { command: ["tasks", "claim"], args: ["id"] },
  mcp: { tool: "task_claim" },
  upstream: true,
});
