import { expect, test } from "bun:test";
import type { ClaimResult, CreatedConnection, OutputOf, postMessage } from "@openboard/contract";
import type { App } from "../../src/index.ts";
import { BOARD_URL, call, makeApp, PUBLIC_URL } from "../support/app.ts";

const post = { channel: "dev", text: "hi @ada", id: "c1" };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function tool(app: App, name: string, args: object, headers: Record<string, string>, rpcId = 1) {
  return app.fetch(
    new Request(`${PUBLIC_URL}/mcp/local/main`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
}

async function connect(app: App, options: object = {}): Promise<CreatedConnection> {
  const response = await call(app, "POST", "/x/connections", { name: "runner", can: { "*": "all" }, ...options });
  expect(response.status).toBe(201);
  return (await response.json()) as CreatedConnection;
}

async function claim(app: App, secret: string): Promise<ClaimResult> {
  const response = await app.fetch(
    new Request(`${BOARD_URL}/x/connections/claim`, {
      method: "POST",
      headers: { ...bearer(secret), "content-type": "application/json" },
      body: JSON.stringify({ profile: "fixer-2" }),
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ClaimResult;
}

async function success<T>(response: Response): Promise<T> {
  expect(response.status).toBe(200);
  const { result } = (await response.json()) as {
    result: { structuredContent: T; content: { type: string; text: string }[] };
  };
  expect(result).toEqual({
    structuredContent: expect.any(Object),
    content: [{ type: "text", text: JSON.stringify(result.structuredContent) }],
  });
  return result.structuredContent;
}

test("MCP post_message posts as the pinned agent and a retry lands only once", async () => {
  const app = makeApp();
  try {
    const { connection, secret } = await connect(app);
    const { token } = await claim(app, secret);
    const headers = bearer(token);
    const first = await success<OutputOf<typeof postMessage>>(await tool(app, "post_message", post, headers));
    expect(first.message).toMatchObject({
      channel: "dev",
      text: "hi @ada",
      by: { actor: `ob:conn:${connection.id}+fixer-2`, profile: "fixer-2" },
    });
    const retry = await success<OutputOf<typeof postMessage>>(await tool(app, "post_message", post, headers, 2));
    expect(retry.message).toEqual(first.message);
    const read = await call(app, "GET", "/messages?channel=dev");
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ messages: [first.message] });
  } finally {
    await app.close();
  }
});

test("MCP post_message honors a direct profile header and refuses a different pinned profile like REST", async () => {
  const app = makeApp();
  try {
    const direct = await connect(app, { direct: true, profiles: ["fixer-*"] });
    const directHeaders = { ...bearer(direct.secret), "x-board-profile": "fixer-3" };
    const posted = await success<OutputOf<typeof postMessage>>(await tool(app, "post_message", post, directHeaders));
    expect(posted.message.by).toMatchObject({
      actor: `ob:conn:${direct.connection.id}+fixer-3`,
      profile: "fixer-3",
    });

    const claimable = await connect(app, { name: "worker" });
    const { token } = await claim(app, claimable.secret);
    const headers = { ...bearer(token), "x-board-profile": "fixer-3" };
    const rest = await app.fetch(
      new Request(`${BOARD_URL}/messages`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(post),
      }),
    );
    const mcp = await tool(app, "post_message", post, headers);
    expect(rest.status).toBe(403);
    expect(mcp.status).toBe(403);
    const rejection = await rest.json();
    expect(rejection).toMatchObject({ error: { code: "forbidden", message: expect.stringContaining("fixer-2") } });
    expect(await mcp.json()).toEqual(rejection);
  } finally {
    await app.close();
  }
});

test("MCP returns a forbidden tool error for writes to a read-only channel", async () => {
  const app = makeApp();
  try {
    const seed = await call(app, "POST", "/messages", { channel: "dev", text: "seed" });
    expect(seed.status).toBe(201);
    const {
      message: { id },
    } = (await seed.json()) as OutputOf<typeof postMessage>;
    const { secret } = await connect(app, { direct: true, can: { dev: ["read"] } });

    const writes = [
      ["post_message", post, "post"],
      ["label_message", { id, set: { status: "ready" } }, "label"],
      ["react_to_message", { id, emoji: "eyes" }, "react"],
      ["edit_message", { id, text: "edited" }, "post"],
    ] as const;
    for (const [name, args, permission] of writes) {
      const message = `this connection's grant lacks ${permission} in dev`;
      const response = await tool(app, name, args, bearer(secret));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        result: {
          isError: true,
          structuredContent: { code: "forbidden", message },
          content: [{ type: "text", text: expect.stringContaining(`error: forbidden: ${message}`) }],
        },
      });
    }
  } finally {
    await app.close();
  }
});

test("MCP label_message, react_to_message and edit_message persist changes under the pinned agent", async () => {
  const app = makeApp();
  try {
    const { connection, secret } = await connect(app);
    const { token } = await claim(app, secret);
    const headers = bearer(token);
    const {
      message: { id },
    } = await success<OutputOf<typeof postMessage>>(await tool(app, "post_message", post, headers));

    const writes = [
      ["label_message", { id, set: { status: "ready" } }],
      ["react_to_message", { id, emoji: "eyes" }],
      ["edit_message", { id, text: "edited" }],
    ] as const;
    for (const [name, args] of writes) {
      expect(await success(await tool(app, name, args, headers))).toEqual({ ok: true });
    }

    const read = await call(app, "GET", "/messages?channel=dev");
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      messages: [
        { id, text: "edited", labels: { status: "ready" }, reactions: { eyes: [`ob:conn:${connection.id}+fixer-2`] } },
      ],
    });
  } finally {
    await app.close();
  }
});
