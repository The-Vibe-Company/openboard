import {
  ERRORS,
  type ErrorCode,
  ErrorEnvelope,
  type Operation,
  type OperationInput,
  operations,
} from "@openboard/contract";
import manifest from "../../package.json" with { type: "json" };
import { CSRF_HEADER } from "../auth/sessions.ts";

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
    codes.add("invalid_profile");
    codes.add("forbidden");
  }
  const retryAfter = (operation.scope === "board" || operation.scope === "org") && codes.has("rate_limited");
  const responses: Record<number, { description: string; content: object; headers?: object }> = {};
  for (const code of codes) {
    for (const status of ERRORS[code].statuses) {
      const previous = responses[status]?.description;
      responses[status] = {
        description: previous ? `${previous}, ${code}` : code,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
        ...(status === 429 &&
          retryAfter && {
            headers: {
              "retry-after": { description: "Seconds until the write may be retried.", schema: { type: "integer" } },
            },
          }),
      };
    }
  }
  return responses;
}

function describeOperation(operation: Operation) {
  const { params, query, body } = operation.input;
  const sessionAuth = operation.scope === "org" || operation.scope === "account";
  const needsCsrf = sessionAuth && operation.route.method !== "GET";
  const fields = [
    ...parameters(params, "path"),
    ...parameters(query, "query"),
    ...(needsCsrf
      ? [
          {
            name: CSRF_HEADER,
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "The session CSRF value from GET /api/x/session. Send the configured public origin as Origin.",
          },
        ]
      : []),
  ];
  const responses = errorResponses(operation);
  const success = {
    description: "Success",
    content: {
      [operation.responseType ?? "application/json"]: { schema: operation.output },
      ...(operation.eventStream && { [operation.eventStream]: { schema: { type: "string" } } }),
    },
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
    ...(sessionAuth && {
      servers: [{ url: "/" }],
      security: [{ sessionAuth: [] }],
    }),
    ...(operation.route.mount && { servers: [{ url: "/" }] }),
    ...(fields.length > 0 && { parameters: fields }),
    ...(query && { "x-query-schema": query }),
    ...(body && {
      requestBody: { required: !operation.bodyOptional, content: { "application/json": { schema: body } } },
    }),
    responses,
  };
}

/** Project the mounted board operations into the same document for HTTP and code generation. */
export function createOpenApi() {
  const paths: Record<string, Record<string, ReturnType<typeof describeOperation>>> = {};
  for (const operation of operations) {
    if (operation.scope === "account" && !operation.route.mount) continue;
    const mount = operation.scope === "org" ? "/api/x" : (operation.route.mount ?? "");
    const path = (mount + operation.route.path).replace(/:([^/]+)/g, "{$1}");
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
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        sessionAuth: { type: "apiKey", in: "cookie", name: "__Host-ob_session" },
      },
    },
    paths,
  };
}
