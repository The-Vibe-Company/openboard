import { Type } from "@sinclair/typebox";
import { LabelKey } from "../../entities/messages.ts";
import { defineOperation } from "../../operation.ts";
import { ChannelFilter, labelFilter } from "../thread-filters.ts";
import { TaskClaim, TaskLease, TaskRoot } from "./claim.ts";

// Upstream's exact-match values must be representable in the board's label store.
const exactLabels = Type.Record(
  LabelKey,
  Type.String({ maxLength: 256, pattern: "^(?:[^\\u0000\\uD800-\\uDFFF]|[\\uD800-\\uDBFF][\\uDC00-\\uDFFF])*$" }),
  { additionalProperties: false },
);

export const claimNextTask = defineOperation({
  name: "claimNextTask",
  operationId: "claimNextTask",
  summary: "Claim the next ready task in a channel or subtree.",
  route: { method: "POST", path: "/tasks/claim" },
  scope: "board",
  input: {
    body: Type.Object(
      {
        channel: ChannelFilter,
        lease: TaskLease,
        label: Type.Optional(
          Type.Union([exactLabels, labelFilter], {
            description:
              "Repeatable root label filter: key for presence, key=a|b for either value; all filters must match.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Union([Type.Object({ task: TaskRoot, claim: TaskClaim }), Type.Object({ task: Type.Null() })]),
  errors: ["invalid_request", "forbidden"],
  access: { permission: "label", channel: "fromInput" },
  effects: { readOnly: false, idempotent: false, emits: ["task.expired", "task.claimed"], meter: "task_claims" },
  cli: { command: ["tasks", "claim"], args: [] },
  mcp: { tool: "task_claim_next" },
  upstream: true,
});
