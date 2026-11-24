import { Type } from "@sinclair/typebox";
import { TaskHoldKind } from "../../entities/task-events.ts";
import { defineOperation, Ref } from "../../operation.ts";
import { TaskRoot } from "./claim.ts";

export const blockTask = defineOperation({
  name: "blockTask",
  operationId: "blockTask",
  summary: "Hold a task for a person and end any claim used to place the hold.",
  route: { method: "POST", path: "/tasks/:id/block" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("task") }),
    body: Type.Object(
      {
        reason: Type.String({ minLength: 1, maxLength: 1000 }),
        kind: Type.Optional(TaskHoldKind),
        epoch: Type.Optional(Type.Integer({ minimum: 1 })),
        token: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ task: TaskRoot }),
  errors: [
    "invalid_request",
    "message_not_found",
    "not_a_task",
    "task_claimed",
    "claim_lost",
    "task_not_owned",
    "task_blocked",
    "task_finished",
  ],
  access: { permission: "read", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: false, emits: ["task.expired", "task.blocked"] },
  cli: { command: ["tasks", "block"], args: ["id", "reason"], implicit: ["epoch", "token"] },
  mcp: { tool: "task_block" },
  upstream: true,
});

export const unblockTask = defineOperation({
  name: "unblockTask",
  operationId: "unblockTask",
  summary: "Lift a task hold and resume normal prerequisite checks.",
  route: { method: "POST", path: "/tasks/:id/unblock" },
  scope: "board",
  input: { params: Type.Object({ id: Ref("task") }) },
  output: Type.Object({
    task: TaskRoot,
    outcome: Type.Optional(Type.Union([Type.Literal("unblocked"), Type.Literal("unchanged")])),
  }),
  errors: ["invalid_request", "message_not_found", "not_a_task", "task_not_owned"],
  access: { permission: "read", channel: "fromMessage" },
  effects: { readOnly: false, idempotent: true, emits: ["task.expired", "task.unblocked", "task.ready"] },
  cli: { command: ["tasks", "unblock"], args: ["id"] },
  mcp: { tool: "task_unblock" },
  upstream: true,
});
