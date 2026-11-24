import { expect, test } from "bun:test";
import type { App } from "../../src/index.ts";
import { makeApp, OWNER, PUBLIC_URL } from "../support/app.ts";

const endpoint = `${PUBLIC_URL}/mcp/local/main`;
const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

function post(app: App, body: string, accept?: string) {
  const headers = new Headers({ authorization: `Bearer ${OWNER.token}`, "content-type": "application/json" });
  if (accept !== undefined) headers.set("accept", accept);
  return app.fetch(new Request(endpoint, { method: "POST", headers, body, redirect: "error" }));
}

test.each(["GET", "DELETE"])("%s returns 405 JSON with Allow: POST and no redirect", async (method) => {
  const app = makeApp();
  try {
    const response = await app.fetch(new Request(endpoint, { method, redirect: "error" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.get("content-type")).toStartWith("application/json");
    expect(await response.json()).toEqual({ error: { message: "MCP is stateless. Use POST for each request." } });
  } finally {
    await app.close();
  }
});

test.each([
  ["absent", undefined],
  ["SSE only", "text/event-stream"],
  ["a wildcard", "*/*"],
  ["JSON sequence", "application/json-seq"],
  ["JSON with zero quality", "application/json;q=0"],
  ["JSON in quoted parameter text", 'text/plain; note="x, application/json, y"'],
])("POST returns 406 JSON when Accept is %s", async (_description, accept) => {
  const app = makeApp();
  try {
    const response = await post(app, JSON.stringify(ping), accept);
    expect(response.status).toBe(406);
    expect(response.headers.get("content-type")).toStartWith("application/json");
    expect(await response.json()).toEqual({ error: { message: "Accept must include application/json." } });
  } finally {
    await app.close();
  }
});

test("POST accepts a JSON media type in a list with parameters", async () => {
  const app = makeApp();
  try {
    const response = await post(app, JSON.stringify(ping), 'text/event-stream, Application/JSON; note="x; q=0"; q=0.5');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  } finally {
    await app.close();
  }
});

test.each([
  ["a batch", JSON.stringify([ping]), -32600, "Invalid Request"],
  ["malformed JSON", "{", -32700, "Parse error"],
])("POST with %s (%s) returns HTTP 400 and JSON-RPC error %i (%s)", async (_description, body, code, message) => {
  const app = makeApp();
  try {
    const response = await post(app, body, "application/json");
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toStartWith("application/json");
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code, message } });
  } finally {
    await app.close();
  }
});
