import { expect, test } from "bun:test";
import type { ClaimResult, CreatedConnection, ErrorBody, OutputOf, postMessage, readThread } from "@openboard/contract";
import type { App } from "../../src/index.ts";
import { BOARD_URL, call, makeApp, PUBLIC_URL } from "../support/app.ts";

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

async function connect(app: App): Promise<CreatedConnection> {
  const response = await call(app, "POST", "/x/connections", { name: "runner", can: { "*": "all" } });
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

async function agent(app: App): Promise<Record<string, string>> {
  const { secret } = await connect(app);
  const { token } = await claim(app, secret);
  return bearer(token);
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

async function thread(app: App, id: string): Promise<OutputOf<typeof readThread>> {
  const response = await call(app, "GET", `/messages/${id}`);
  expect(response.status).toBe(200);
  return (await response.json()) as OutputOf<typeof readThread>;
}

/** Posts a root to `dev` over REST and returns its ID (the fresh board's first message is #2). */
async function root(app: App, text = "root"): Promise<string> {
  const response = await call(app, "POST", "/messages", { channel: "dev", text });
  expect(response.status).toBe(201);
  return ((await response.json()) as OutputOf<typeof postMessage>).message.id;
}

test("MCP post_message with re lands in the thread, and a reply to a reply joins the root's thread", async () => {
  const app = makeApp();
  try {
    const headers = await agent(app);
    const first = await root(app, "hello");
    const replied = await success<OutputOf<typeof postMessage>>(
      await tool(app, "post_message", { re: first, text: "on it" }, headers),
    );
    expect(replied.message).toMatchObject({ re: first, thread: first, replyTo: null, text: "on it" });
    const reply = replied.message.id;

    const nested = await success<OutputOf<typeof postMessage>>(
      await tool(app, "post_message", { re: reply, text: "again" }, headers, 2),
    );
    expect(nested.message).toMatchObject({ re: first, thread: first, replyTo: reply, text: "again" });

    const read = await thread(app, first);
    expect(read.message.id).toBe(first);
    expect(read.replies.map((message) => [message.id, message.replyTo])).toEqual([
      [reply, null],
      [nested.message.id, reply],
    ]);

    const channel = await call(app, "GET", "/messages?channel=dev");
    expect(channel.status).toBe(200);
    expect(await channel.json()).toMatchObject({
      messages: [{ id: first }, { id: reply }, { id: nested.message.id }],
    });
  } finally {
    await app.close();
  }
});

test("MCP post_message after an older reply answers newer_message with the read of what came after and posts nothing", async () => {
  const app = makeApp();
  try {
    const headers = await agent(app);
    const first = await root(app, "hello");
    const older = await success<OutputOf<typeof postMessage>>(
      await tool(app, "post_message", { re: first, text: "a", after: first }, headers),
    );
    const olderId = older.message.id;
    const newer = await success<OutputOf<typeof postMessage>>(
      await tool(app, "post_message", { re: first, text: "b", after: olderId }, headers, 2),
    );

    const late = await tool(app, "post_message", { re: first, text: "c", after: olderId }, headers, 3);
    expect(late.status).toBe(200);
    const { result } = (await late.json()) as {
      result: { isError: true; structuredContent: ErrorBody; content: { type: string; text: string }[] };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "newer_message",
      message: `#${newer.message.id} came after #${olderId}`,
      next: [{ kind: "run", argv: ["ob", "read", first, "--after", olderId] }],
    });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toStartWith("error: newer_message:");
    expect(result.content[0]?.text).toContain(`next: ob read ${first} --after ${olderId}`);

    const read = await thread(app, first);
    expect(read.replies.map((message) => [message.id, message.text])).toEqual([
      [olderId, "a"],
      [newer.message.id, "b"],
    ]);
  } finally {
    await app.close();
  }
});
