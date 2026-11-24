import { Type } from "@sinclair/typebox";
import { SchemaDefinition, SchemaView } from "../../entities/schemas/view.ts";
import { defineOperation, Ref } from "../../operation.ts";

export const listSchemas = defineOperation({
  name: "listSchemas",
  operationId: "schemas",
  summary: "List the board's schemas, built-ins first.",
  route: { method: "GET", path: "/schemas" },
  scope: "board",
  input: {},
  output: Type.Object({ schemas: Type.Array(SchemaView) }),
  errors: [],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["schemas"], args: [] },
  mcp: { tool: "list_schemas" },
  upstream: true,
});

export const readSchema = defineOperation({
  name: "readSchema",
  operationId: "schema",
  summary: "Read one schema version by name@version.",
  route: { method: "GET", path: "/schemas/:id" },
  scope: "board",
  input: { params: Type.Object({ id: Ref("schema") }) },
  invalidInputCode: "invalid_schema_id",
  output: Type.Object({ schema: SchemaView }),
  errors: ["invalid_schema_id", "schema_not_found"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["schemas", "inspect"], args: ["id"] },
  mcp: { tool: "read_schema" },
  upstream: true,
});

export const createSchema = defineOperation({
  name: "createSchema",
  summary: "Register an immutable schema version.",
  route: { method: "POST", path: "/schemas" },
  scope: "board",
  input: {
    body: Type.Object(
      {
        name: Type.String({ pattern: "^[a-z][a-z0-9._-]*$" }),
        version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        // Upstream accepts Unicode scalar values except NUL, including paired UTF-16 surrogates.
        description: Type.Optional(
          Type.String({ pattern: String.raw`^(?:[^\u0000\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])+$` }),
        ),
        schema: SchemaDefinition,
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({ schema: SchemaView, created: Type.Boolean() }),
  status: { createdWhen: "created" },
  errors: ["no_schemas", "forbidden", "invalid_request"],
  access: { permission: "manage", channel: "any" },
  effects: { readOnly: false, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "Schema registration is deferred; the CLI will read the definition from a file.",
  upstream: true,
  stub: true,
});
