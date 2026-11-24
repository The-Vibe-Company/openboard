import {
  BoardError,
  type ErrorBody,
  type NextStep,
  type OperationInput,
  operations,
  type RawInput,
} from "@openboard/contract";
import type { BoardOperation } from "../http/board.ts";

export interface ToolCall {
  readonly id: number | string;
  readonly operation: BoardOperation;
  readonly args: unknown;
}

export type InvokeTool = (operation: BoardOperation, readInput: () => RawInput) => Promise<Response>;

export function findTool(name: unknown): BoardOperation | undefined {
  if (typeof name !== "string") return undefined;
  return operations.find(
    (operation): operation is BoardOperation =>
      operation.scope === "board" && !!operation.mcp && operation.mcp.tool === name,
  );
}

/** Split the SDK-style flat input using the contract's field locations. */
function toolInput(operation: BoardOperation, args: unknown): RawInput {
  if (args === undefined) return { typed: true };
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new BoardError("invalid_request", "tool arguments must be a JSON object");
  }
  const input: OperationInput = operation.input;
  const params: Record<string, unknown> = {};
  const query: Record<string, unknown> = {};
  const body: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(args)) {
    const value = key === "wait" && typeof raw === "number" ? Math.min(raw, 25) : raw;
    if (input.params && Object.hasOwn(input.params.properties, key)) params[key] = value;
    else if (input.query && Object.hasOwn(input.query.properties, key)) {
      query[key] = value;
    } else if (input.body && Object.hasOwn(input.body.properties, key)) body[key] = value;
    else throw new BoardError("invalid_request", `${key}: unexpected tool argument`);
  }
  return { params, query, body, typed: true };
}

function nextText(step: NextStep): string {
  switch (step.kind) {
    case "run":
      return step.argv.map((arg) => (/^[\w./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\"'\"'")}'`)).join(" ");
    case "call":
      return `${step.operation} ${JSON.stringify(step.input)}`;
    case "wait":
      return `wait ${step.seconds}s`;
    case "read":
      return step.url;
  }
}

function errorText(error: ErrorBody): string {
  return [
    `error: ${error.code}: ${error.message}`,
    ...(error.next ?? []).map((step) => `next: ${nextText(step)}`),
  ].join("\n");
}

export async function toolResponse({ id, operation, args }: ToolCall, invoke: InvokeTool): Promise<Response> {
  const response = await invoke(operation, () => toolInput(operation, args));
  const json = await response.text();
  const body = JSON.parse(json);
  const result = response.ok
    ? { structuredContent: body, content: [{ type: "text", text: json }] }
    : {
        isError: true,
        structuredContent: body.error,
        content: [{ type: "text", text: errorText(body.error) }],
      };
  const headers = new Headers();
  const retry = response.headers.get("retry-after");
  if (retry !== null) headers.set("retry-after", retry);
  return Response.json({ jsonrpc: "2.0", id, result }, { headers });
}
