import { Type } from "@sinclair/typebox";
import { defineOperation } from "../../operation.ts";
import { ChannelFilter } from "../thread-filters.ts";

export const countTasks = defineOperation({
  name: "countTasks",
  operationId: "countTasks",
  summary: "Count tasks by state in a channel, subtree, or the whole board.",
  route: { method: "GET", path: "/tasks/counts" },
  scope: "board",
  input: { query: Type.Object({ channel: Type.Optional(ChannelFilter) }, { additionalProperties: false }) },
  output: Type.Object({
    counts: Type.Object({
      open: Type.Integer({ minimum: 0 }),
      waiting: Type.Integer({ minimum: 0 }),
      ready: Type.Integer({ minimum: 0 }),
      claimed: Type.Integer({ minimum: 0 }),
      blocked: Type.Integer({ minimum: 0 }),
      completed: Type.Integer({ minimum: 0 }),
      failed: Type.Integer({ minimum: 0 }),
      canceled: Type.Integer({ minimum: 0 }),
      all: Type.Integer({ minimum: 0 }),
    }),
  }),
  errors: ["invalid_request"],
  access: { permission: "read", channel: "fromInputOrAny" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["tasks", "counts"], args: ["channel"] },
  mcp: { tool: "count_tasks" },
  upstream: false,
});
