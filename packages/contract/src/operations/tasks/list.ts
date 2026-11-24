import { Type } from "@sinclair/typebox";
import { ThreadSummary } from "../../entities/threads.ts";
import { defineOperation, Ref } from "../../operation.ts";
import { ChannelFilter } from "../thread-filters.ts";

/** A handle or an ID, as `owner` and `for` take one. */
const Named = (description: string) =>
  Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: "^[^\\u0000]+$", description }));

export const listTasks = defineOperation({
  name: "listTasks",
  operationId: "tasks",
  summary:
    "List the tasks of a channel, a subtree (`dev/`), or the whole board, oldest first, each as its thread's summary.",
  route: { method: "GET", path: "/tasks" },
  scope: "board",
  input: {
    query: Type.Object(
      {
        channel: Type.Optional(ChannelFilter),
        state: Type.Optional(
          Type.String({
            pattern: "^(open|all|waiting|ready|claimed|blocked|completed|failed|canceled)$",
            description: "`open` by default (`waiting`, `ready`, `claimed`, `blocked`), `all`, or one task state.",
          }),
        ),
        label: Type.Optional(
          Type.Array(Type.String({ pattern: "^[a-z0-9][a-z0-9_.-]*(=.*)?$" }), {
            description: "A root label `key` that must be set, or `key=value` (`key=v|w`): repeatable, all must match.",
          }),
        ),
        by: Type.Optional(
          Type.String({
            pattern: "^[^\\u0000]+$",
            description: "A task whose root this handle, actor ID, or `me` (the caller's actor) wrote.",
          }),
        ),
        owner: Named("A task this principal owns: its handle or principal ID."),
        for: Named("A task assigned to this actor: its handle or actor ID."),
        needs: Type.Optional(
          Ref("task", { description: "A prerequisite task ID that the listed tasks directly need." }),
        ),
        after: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 128,
            description: "A page's `cursor`, or a task ID: the tasks whose root comes after it.",
          }),
        ),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Maximum tasks, 50 by default." })),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({
    tasks: Type.Array(ThreadSummary),
    cursor: Type.String({ description: "The `after` that reads the next page." }),
  }),
  errors: ["invalid_request", "invalid_cursor"],
  access: { permission: "read", channel: "fromInputOrAny" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["tasks"], args: ["channel"] },
  mcp: { tool: "list_tasks" },
  upstream: true,
});
