import {
  ERRORS,
  type ErrorCode,
  ErrorEnvelope,
  type Operation,
  type OperationInput,
  operations,
} from "@openboard/contract";
import manifest from "../../package.json" with { type: "json" };

function parameters(schema: OperationInput["params"], location: "path" | "query") {
  return Object.entries(schema?.properties ?? {}).map(([name, field]) => ({
    name,
    in: location,
    required: location === "path" || (schema?.required?.includes(name) ?? false),
    schema: field,
  }));
}

function errorResponses(operation: Operation) {
  const codes = new Set<ErrorCode>(["invalid_request", "internal", ...operation.errors]);
  if (operation.scope !== "public") {
    codes.add("unauthorized");
    codes.add("not_found");
  }
  const responses: Record<number, { description: string; content: object }> = {};
  for (const code of codes) {
    for (const status of ERRORS[code].statuses) {
      const previous = responses[status]?.description;
      responses[status] = {
        description: previous ? `${previous}, ${code}` : code,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
      };
    }
  }
  return responses;
}

function describeOperation(operation: Operation) {
  const { params, query, body } = operation.input;
  const fields = [...parameters(params, "path"), ...parameters(query, "query")];
  const responses = errorResponses(operation);
  const success = {
    description: "Success",
    content: { "application/json": { schema: operation.output } },
  };

  const { status } = operation;
  if (typeof status === "object") {
    responses[200] = success;
    responses[201] = success;
  } else {
    responses[status ?? 200] = success;
  }

  return {
    operationId: operation.operationId ?? operation.name,
    summary: operation.summary,
    ...(operation.scope === "public" && { security: [] }),
    ...(fields.length > 0 && { parameters: fields }),
    ...(query && { "x-query-schema": query }),
    ...(body && { requestBody: { required: true, content: { "application/json": { schema: body } } } }),
    responses,
  };
}

/** Project the mounted board operations into the same document for HTTP and code generation. */
export function createOpenApi() {
  const paths: Record<string, Record<string, ReturnType<typeof describeOperation>>> = {};
  for (const operation of operations) {
    if (operation.scope !== "board" && operation.scope !== "public") continue;
    const path = operation.route.path.replace(/:([^/]+)/g, "{$1}");
    paths[path] ??= {};
    paths[path][operation.route.method.toLowerCase()] = describeOperation(operation);
  }
  return {
    openapi: "3.1.0" as const,
    info: { title: "OpenBoard", version: manifest.version },
    servers: [{ url: "." }],
    security: [{ bearerAuth: [] }],
    components: {
      schemas: { ErrorEnvelope },
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
    paths,
  };
}
