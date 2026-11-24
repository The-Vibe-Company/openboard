import { Type } from "@sinclair/typebox";
import { defineOperation } from "../../operation.ts";
import { TaskClaim, TaskLease, TaskRoot } from "./claim.ts";
import { ChannelFilter } from "../thread-filters.ts";

export const claimNextTask = defineOperation({
  name: "claimNextTask",
  operationId: "claimNextTask",
  summary: "Claim the next ready task in a channel or subtree.",
  route: { method: "POST", path: "/tasks/claim" },
  scope: "board",
  input: {
    body: Type.Object({ channel: ChannelFilter, lease: TaskLease }, { additionalProperties: false }),
  },
  output: Type.Union([Type.Object({ task: TaskRoot, claim: TaskClaim }), Type.Object({ task: Type.Null() })]),
  errors: ["invalid_request", "forbidden"],
  access: { permission: "label", channel: "fromInput" },
  effects: { readOnly: false, idempotent: false, emits: ["task.expired", "task.claimed"], meter: "task_claims" },
  cli: { command: ["tasks", "claim"], args: [] },
  mcp: { tool: "task_claim_next" },
  upstream: true,
});
