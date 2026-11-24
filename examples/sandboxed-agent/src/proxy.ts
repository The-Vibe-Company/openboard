import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Client } from "@the-vibe-company/openboard";

export type Policy = Awaited<ReturnType<Client["getConnectionPolicy"]>>;

const loopback = "127.0.0.1";
const authorizationTemplate = "Bearer ${OPENBOARD_SECRET}";
const requestHeaders = ["accept", "content-type", "last-event-id", "mcp-session-id", "mcp-protocol-version"];
const responseHeaders = ["content-type", "mcp-session-id", "mcp-protocol-version", "retry-after"];

function refuse(response: ServerResponse, status: number, code: string, message: string) {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: { code, message } }));
}

function allowed(policy: Policy, method: string, path: string) {
  const parts = path.replace(/\/+$/, "").split("/");
  return policy.routes.some((route) => {
    if (route.method !== method) return false;
    const pattern = route.path.split("/");
    return (
      pattern.length === parts.length &&
      pattern.every((segment, index) => (segment.startsWith(":") ? Boolean(parts[index]) : segment === parts[index]))
    );
  });
}

function requestTarget(request: IncomingMessage, host: string, board: URL, policy: Policy) {
  const raw = request.url ?? "";
  if (request.headers.host !== host || !raw.startsWith("/") || raw.startsWith("//") || /[\\#]/.test(raw)) {
    return null;
  }
  const target = new URL(board.origin + raw);
  // Require the same canonical path at policy evaluation and at the board.
  if (target.pathname !== raw.split("?")[0] || !allowed(policy, request.method ?? "", target.pathname)) return null;
  return target;
}

async function forward(request: IncomingMessage, response: ServerResponse, target: URL, pins: Headers) {
  const headers = new Headers(pins);
  for (const name of requestHeaders) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  const controller = new AbortController();
  response.once("close", () => controller.abort());
  const body = request.method === "GET" || request.method === "HEAD" ? null : Readable.toWeb(request);
  const options = {
    method: request.method,
    headers,
    body,
    duplex: "half",
    redirect: "manual",
    signal: controller.signal,
  } as const;
  const upstream = await fetch(target, options);
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    refuse(response, 502, "unreachable", "the board returned a redirect");
    return;
  }
  for (const name of responseHeaders) {
    const value = upstream.headers.get(name);
    if (value !== null) response.setHeader(name, value);
  }
  response.statusCode = upstream.status;
  if (upstream.body) await pipeline(upstream.body, response);
  else response.end();
}

export async function startProxy(policy: Policy, secret: string) {
  const board = new URL(policy.env.BOARD_URL);
  if (
    !["http:", "https:"].includes(board.protocol) ||
    board.username ||
    board.password ||
    policy.headers.authorization !== authorizationTemplate ||
    policy.env.BOARD_TOKEN !== "<placeholder>"
  ) {
    throw new Error("invalid board proxy policy");
  }
  const pins = new Headers({
    authorization: `Bearer ${secret}`,
    "x-board-profile": policy.headers["x-board-profile"],
    "x-board-can": policy.headers["x-board-can"],
  });

  const server = createServer((request, response) => {
    const target = requestTarget(request, local.host, board, policy);
    if (!target) return refuse(response, 403, "forbidden", "the request is outside the board proxy policy");
    void forward(request, response, target, pins).catch(() => {
      if (response.headersSent || response.destroyed) response.destroy();
      else refuse(response, 502, "unreachable", "the board proxy could not reach the board");
    });
  });
  const denyTunnel = (_request: IncomingMessage, socket: { end(data: string): void }) =>
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  server.on("connect", denyTunnel);
  server.on("upgrade", denyTunnel);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, loopback, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing proxy address");
  const local = new URL(`http://${loopback}:${address.port}`);
  return {
    env: { ...policy.env, BOARD_URL: local.origin + board.pathname },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
