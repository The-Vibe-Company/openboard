import { expect, test } from "bun:test";
import type { ClaimResult, CreatedConnection, ErrorBody, OutputOf, postMessage } from "@openboard/contract";
import type { App } from "../../src/index.ts";
import { BOARD_URL, call, makeApp, OWNER, PUBLIC_URL } from "../support/app.ts";

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function toolRequest(name: string, args: unknown, headers: Record<string, string>) {
  return new Request(`${PUBLIC_URL}/mcp/local/main`, {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
}

function tool(
  app: App,
  name: string,
  args?: unknown,
  headers: Record<string, string> = bearer(OWNER.token),
  ip?: string,
) {
  return app.fetch(toolRequest(name, args, headers), { ip });
}

async function post(app: App, channel: string, text: string, re?: string) {
  const response = await call(app, "POST", "/messages", re === undefined ? { channel, text } : { text, re });
  expect(response.status).toBe(201);
  return ((await response.json()) as OutputOf<typeof postMessage>).message.id;
}

test("MCP read tools return their exact REST JSON as structured content and one text item", async () => {
  const lines: unknown[] = [];
  const app = makeApp({ log: { info: (_message, fields) => lines.push(fields), error: () => {} } });
  try {
    const id = await post(app, "dev", "root");
    expect(id).toBe("2");
    await post(app, "dev", "reply", id);
    await post(app, "dev", "second");
    await post(app, "dev", "third");
    const reads = [
      ["list_threads", { channel: "dev", limit: 2 }, "/threads?channel=dev&limit=2"],
      ["read_thread", { id }, `/messages/${id}`],
      ["list_messages", { channel: "dev", limit: 2 }, "/messages?channel=dev&limit=2"],
      ["list_channels", {}, "/channels"],
      ["whoami", undefined, "/me"],
    ] as const;
    for (const [name, args, path] of reads) {
      const rest = await call(app, "GET", path);
      expect(rest.status).toBe(200);
      const text = await rest.text();
      const response = await tool(app, name, args);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { structuredContent: JSON.parse(text), content: [{ type: "text", text }] },
      });
    }
    expect(lines.filter((line) => (line as { req: string }).req === "POST /mcp/local/main")).toEqual(
      ["listThreads", "readThread", "listMessages", "listChannels", "getMe"].map((op) =>
        expect.objectContaining({ op, org: "local", actor: expect.any(String), status: 200 }),
      ),
    );
  } finally {
    await app.close();
  }
});

test("MCP uses the request can and the agent's pinned profile and can", async () => {
  const app = makeApp();
  try {
    await post(app, "dev", "visible");
    const id = await post(app, "other", "hidden");
    const connection = await call(app, "POST", "/x/connections", { name: "runner", can: { "*": "all" } });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as CreatedConnection;
    const claim = await app.fetch(
      new Request(`${BOARD_URL}/x/connections/claim`, {
        method: "POST",
        headers: { ...bearer(secret), "content-type": "application/json" },
        body: JSON.stringify({ profile: "fixer", can: { dev: ["read"] } }),
      }),
    );
    expect(claim.status).toBe(200);
    const { token } = (await claim.json()) as ClaimResult;
    const agent = bearer(token);
    const me = await tool(app, "whoami", {}, agent);
    expect(await me.json()).toMatchObject({
      result: { structuredContent: { profile: "fixer", can: { dev: ["read"] } } },
    });
    const wrongProfile = await tool(app, "whoami", {}, { ...agent, "x-board-profile": "different" });
    expect(wrongProfile.status).toBe(403);
    for (const headers of [agent, { ...bearer(OWNER.token), "x-board-can": "dev=read" }]) {
      expect(await (await tool(app, "list_threads", { channel: "dev" }, headers)).json()).toMatchObject({
        result: { structuredContent: { threads: [expect.any(Object)] } },
      });
      const rest = await app.fetch(new Request(`${BOARD_URL}/messages/${id}`, { headers }));
      expect(rest.status).toBe(404);
      const { error } = (await rest.json()) as { error: ErrorBody };
      expect(error.code).toBe("message_not_found");
      const response = await tool(app, "read_thread", { id }, headers);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: {
          isError: true,
          structuredContent: error,
          content: [{ type: "text", text: `error: message_not_found: ${error.message}` }],
        },
      });
    }
  } finally {
    await app.close();
  }
});

test("invalid arguments are tool errors with next steps, while unknown tools are JSON-RPC errors", async () => {
  const app = makeApp();
  try {
    for (const args of [{ channel: "dev", limit: 0 }, { channel: "dev", limit: "2" }, { unexpected: true }, []]) {
      const response = await tool(app, "list_threads", args);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        result: {
          isError: true,
          structuredContent: { code: "invalid_request", next: [{ kind: "run", argv: ["ob"] }] },
          content: [{ type: "text", text: expect.stringMatching(/^error: invalid_request: [^\n]+\nnext: ob$/) }],
        },
      });
    }
    const unknown = await tool(app, "missing", {});
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32602, message: "Unknown tool" },
    });
  } finally {
    await app.close();
  }
});

test("MCP and REST share the authentication rate limit on the same instance", async () => {
  const app = makeApp();
  try {
    const [instance] = app.instances;
    if (!instance) throw new Error("expected a server instance");
    const ip = "192.0.2.1";
    for (let i = 0; i < 20; i++) {
      expect((await tool(instance, "whoami", {}, {}, ip)).status).toBe(401);
    }
    const request = toolRequest("whoami", {}, bearer(OWNER.token));
    const limited = await instance.fetch(request, { ip });
    expect(request.bodyUsed).toBe(false);
    const rest = await instance.fetch(new Request(`${BOARD_URL}/me`, { headers: bearer(OWNER.token) }), { ip });
    expect(limited.status).toBe(429);
    expect(rest.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3");
    expect(await limited.json()).toEqual(await rest.json());
  } finally {
    await app.close();
  }
});

test("a tool request above 25 seconds arms a 25-second wait", async () => {
  const timer = Promise.withResolvers<{ delay: number; expire: () => void }>();
  const app = makeApp({
    schedule(delay, expire) {
      timer.resolve({ delay, expire });
      return () => {};
    },
  });
  try {
    const pending = tool(app, "read_events", { after: "0", wait: 300 });
    const { delay, expire } = await Promise.race([
      timer.promise,
      pending.then(() => {
        throw new Error("the tool returned before the wait was armed");
      }),
    ]);
    expect(delay).toBe(25_000);
    expire();
    expect(await (await pending).json()).toMatchObject({ result: { structuredContent: { events: [], cursor: "0" } } });
  } finally {
    await app.close();
  }
});
