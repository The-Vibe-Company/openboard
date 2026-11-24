import { expect, test } from "bun:test";
import { type ClaimResult, type CreatedConnection, operations, postMessage, readThread } from "@openboard/contract";
import type { App } from "../../src/index.ts";
import { makeApp, OWNER, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";

const local = "/mcp/local/main";
const list = { jsonrpc: "2.0", id: 2, method: "tools/list" };

function request(app: App, path: string, message: unknown, headers: Record<string, string> = {}) {
  return app.fetch(
    new Request(PUBLIC_URL + path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(message),
    }),
  );
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function claimed(app: App, path: string, headers: Record<string, string>) {
  const created = await request(app, `${path}/x/connections`, { name: "robot", can: { "*": "all" } }, headers);
  expect(created.status).toBe(201);
  const { secret } = (await created.json()) as CreatedConnection;
  const claim = await request(app, `${path}/x/connections/claim`, { profile: "robot" }, bearer(secret));
  expect(claim.status).toBe(200);
  return (await claim.json()) as ClaimResult;
}

test("a claimed token initializes and lists every contract tool as stateless JSON", async () => {
  const app = makeApp();
  try {
    const { token } = await claimed(app, "/api/local/main", bearer(OWNER.token));
    const headers = { ...bearer(token), "x-board-profile": "robot", "x-board-can": "*=read" };
    const initialized = await request(
      app,
      local,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
      },
      headers,
    );
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get("content-type")).toStartWith("application/json");
    expect(initialized.headers.has("mcp-session-id")).toBe(false);
    expect(await initialized.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "openboard" }, capabilities: { tools: {} }, protocolVersion: "2025-06-18" },
    });

    const response = await request(app, local, list, headers);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("application/json");
    const body = (await response.json()) as { result: { tools: { name: string }[] } };
    expect(body).toMatchObject({ jsonrpc: "2.0", id: 2 });
    const { tools } = body.result;
    const exposed = operations.flatMap((operation) => (operation.mcp ? [operation.mcp.tool] : []));
    expect(tools.map(({ name }) => name).sort()).toEqual(exposed.sort());
    expect(new Set(exposed).size).toBe(exposed.length);
    const postTool = {
      name: "post_message",
      description: postMessage.summary,
      inputSchema: JSON.parse(JSON.stringify(postMessage.input.body)),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
    };
    expect(tools.find(({ name }) => name === "post_message")).toEqual(postTool);
    expect(tools.find(({ name }) => name === "read_thread")).toMatchObject({
      inputSchema: {
        properties: JSON.parse(
          JSON.stringify({
            ...readThread.input.params.properties,
            ...readThread.input.query.properties,
          }),
        ),
        required: ["id"],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    });
    for (const name of ["delete_message", "revoke_grant"]) {
      expect(tools.find((tool) => tool.name === name)).toMatchObject({ annotations: { destructiveHint: true } });
    }
    expect(await (await request(app, "/mcp", list, headers)).json()).toEqual(body);
    expect((await request(app, "/mcp/local/main/tools", list, headers)).status).toBe(404);
  } finally {
    await app.close();
  }
});

test("MCP requires a credential and returns the REST error envelope", async () => {
  const app = makeApp();
  try {
    const response = await request(app, local, list);
    expect(response.status).toBe(401);
    const rest = await app.fetch(new Request(`${PUBLIC_URL}/api/local/main/me`));
    expect(await response.json()).toEqual(await rest.json());
  } finally {
    await app.close();
  }
});

test("MCP rejects a token on another board and hides the organization from a signed-in outsider", async () => {
  const app = makeBrowserApp();
  try {
    const ada = await browserSession(app.fetch, "ada");
    const lin = await browserSession(app.fetch, "lin");
    expect((await request(app, "/api/x/orgs", { slug: "acme", name: "Acme" }, ada.headers)).status).toBe(201);
    expect((await request(app, "/api/x/orgs/acme/boards", { slug: "ops", name: "Ops" }, ada.headers)).status).toBe(201);
    const { token } = await claimed(app, "/api/acme/main", ada.headers);
    expect((await request(app, "/mcp/acme/main", list, bearer(token))).status).toBe(200);
    const wrongBoard = await request(app, "/mcp/acme/ops", list, bearer(token));
    expect(wrongBoard.status).toBe(401);
    expect(await wrongBoard.json()).toMatchObject({ error: { code: "unauthorized" } });
    const stranger = await request(app, "/mcp/acme/main", list, lin.headers);
    expect(stranger.status).toBe(404);
    expect(await stranger.json()).toMatchObject({ error: { code: "not_found" } });
  } finally {
    await app.close();
  }
});

test("MCP answers unknown methods and acknowledges notifications", async () => {
  const app = makeApp();
  try {
    const headers = bearer(OWNER.token);
    const unknown = await request(app, local, { jsonrpc: "2.0", id: "other", method: "unknown" }, headers);
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({
      jsonrpc: "2.0",
      id: "other",
      error: { code: -32601, message: "Method not found" },
    });
    const notification = await request(app, local, { jsonrpc: "2.0", method: "notifications/initialized" }, headers);
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe("");
  } finally {
    await app.close();
  }
});

test("MCP refuses an Origin outside the public origin", async () => {
  const app = makeApp();
  try {
    const response = await request(app, local, list, { ...bearer(OWNER.token), origin: "https://other.example" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  } finally {
    await app.close();
  }
});

test("MCP answers ping using the negotiated version", async () => {
  const app = makeApp();
  try {
    const headers = { ...bearer(OWNER.token), "mcp-protocol-version": "2025-06-18" };
    const response = await request(app, local, { jsonrpc: "2.0", id: 3, method: "ping" }, headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  } finally {
    await app.close();
  }
});

test("MCP refuses an unsupported protocol version header", async () => {
  const app = makeApp();
  try {
    const headers = { ...bearer(OWNER.token), "mcp-protocol-version": "unsupported" };
    const response = await request(app, local, list, headers);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
  } finally {
    await app.close();
  }
});

test("MCP rejects a scalar params value as an invalid request", async () => {
  const app = makeApp();
  try {
    const response = await request(app, local, { ...list, params: 42 }, bearer(OWNER.token));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32600 } });
  } finally {
    await app.close();
  }
});
