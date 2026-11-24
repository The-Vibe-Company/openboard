import { Type } from "@sinclair/typebox";
import { ChannelPath, Labels, MESSAGE_TEXT_MAX, Mention } from "../../entities/messages.ts";
import { defineOperation, Ref } from "../../operation.ts";
import { TaskAssignee } from "./assign.ts";
import { TaskRoot } from "./claim.ts";

const BatchId = Type.String({ minLength: 1, maxLength: 200 });
const BatchRequest = Type.Optional(Type.String({ minLength: 1, maxLength: 64 }));
const BatchKey = Type.String({ minLength: 1, maxLength: 200 });
const BatchResult = Type.Object({ tasks: Type.Array(TaskRoot) });

export const createTaskBatch = defineOperation({
  name: "createTaskBatch",
  operationId: "createTasks",
  summary: "Start several threads as tasks in one write.",
  route: { method: "POST", path: "/tasks/batch" },
  scope: "board",
  input: {
    body: Type.Object(
      {
        channel: ChannelPath,
        id: Type.Optional(BatchId),
        request: BatchRequest,
        tasks: Type.Array(
          Type.Object(
            {
              key: Type.Optional(BatchKey),
              text: Type.String({ maxLength: MESSAGE_TEXT_MAX }),
              labels: Type.Optional(Labels),
              noSync: Type.Optional(Type.Boolean()),
              for: Type.Optional(TaskAssignee),
              needs: Type.Optional(
                Type.Array(Type.Union([Ref("task"), Type.Object({ key: BatchKey }, { additionalProperties: false })]), {
                  maxItems: 20,
                }),
              ),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: 100, description: "Ordered task definitions." },
        ),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ ...BatchResult.properties, mentions: Type.Optional(Type.Array(Mention)) }),
  status: 201,
  bodyArrayLimitError: {
    array: "tasks",
    code: "batch_too_large",
    message: "A batch can contain at most 100 tasks.",
  },
  errors: [
    "invalid_request",
    "batch_too_large",
    "invalid_needs",
    "reserved_label",
    "forbidden",
    "quota_exceeded",
    "duplicate_id",
  ],
  access: { permission: "post", channel: "fromInput" },
  effects: {
    readOnly: false,
    idempotent: false,
    emits: ["message.posted", "task.created", "task.ready"],
    meter: "messages",
  },
  cli: {
    command: ["tasks", "create"],
    args: ["channel"],
    implicit: ["request"],
    options: { tasks: "file", id: "idempotency-key" },
  },
  mcp: { tool: "task_create_batch" },
  upstream: true,
});

export const getTaskBatch = defineOperation({
  name: "getTaskBatch",
  operationId: "createdTasks",
  summary: "Read the current roots of a batch you created.",
  route: { method: "GET", path: "/tasks/batch/:id" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("taskBatch", { maxLength: 200 }) }),
    query: Type.Object({ request: BatchRequest }, { additionalProperties: false }),
  },
  output: BatchResult,
  errors: ["batch_not_found", "duplicate_id", "invalid_request"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["tasks", "batch"], args: ["id"], implicit: ["request"] },
  mcp: { tool: "task_get_batch" },
  upstream: true,
});
