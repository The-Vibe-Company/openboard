import { BoardError } from "@openboard/contract";
import manifest from "../../package.json" with { type: "json" };
import { readBoundedText } from "../http/input.ts";
import { findTool, type InvokeTool, toolResponse } from "./call.ts";
import { listTools } from "./tools.ts";

const PROTOCOL_VERSION = "2025-06-18";

function rpcError(id: string | number | null, code: number, message: string, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mcpMethodNotAllowed(): Response {
  return Response.json(
    { error: { message: "MCP is stateless. Use POST for each request." } },
    { status: 405, headers: { allow: "POST" } },
  );
}

function acceptsJson(accept: string | null): boolean {
  // Strip quoted parameter contents before splitting on media range and parameter separators.
  const ranges = (accept ?? "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return ranges.split(",").some((entry) => {
    const [mediaType, ...parameters] = entry.trim().toLowerCase().split(";");
    return (
      mediaType?.trim() === "application/json" &&
      !parameters.some((parameter) => /^q\s*=\s*0(?:\.0*)?$/.test(parameter.trim()))
    );
  });
}

export async function mcpPost(request: Request, invoke: InvokeTool): Promise<Response> {
  if (!acceptsJson(request.headers.get("accept"))) {
    return Response.json(
      { error: { message: "Accept must include application/json." } },
      { status: 406, headers: { vary: "Accept" } },
    );
  }

  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && version !== PROTOCOL_VERSION) {
    throw new BoardError("invalid_request", "unsupported MCP-Protocol-Version");
  }

  let message: unknown;
  try {
    message = JSON.parse(await readBoundedText(request));
  } catch (error) {
    if (error instanceof SyntaxError) return rpcError(null, -32700, "Parse error", 400);
    throw error;
  }

  if (
    !isObject(message) ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string" ||
    (message.params !== undefined && !isObject(message.params))
  ) {
    return rpcError(null, -32600, "Invalid Request", 400);
  }
  const { id, method } = message;
  if (id === undefined) return new Response(null, { status: 202 });
  if (!(typeof id === "string" || (typeof id === "number" && Number.isInteger(id)))) {
    return rpcError(null, -32600, "Invalid Request", 400);
  }

  if (method === "tools/call") {
    const params = message.params as Record<string, unknown> | undefined;
    const operation = findTool(params?.name);
    if (!operation) return rpcError(id, -32602, "Unknown tool");
    return toolResponse({ id, operation, args: params?.arguments }, invoke);
  }

  const result = (value: object) => Response.json({ jsonrpc: "2.0", id, result: value });
  if (method === "initialize") {
    return result({
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: "openboard", version: manifest.version },
      capabilities: { tools: {} },
    });
  }
  if (method === "ping") return result({});
  if (method === "tools/list") return result({ tools: listTools() });
  return rpcError(id, -32601, "Method not found");
}
