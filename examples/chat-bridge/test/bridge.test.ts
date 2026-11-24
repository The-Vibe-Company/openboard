import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, mintLocalOwnerToken, type Ports } from "@openboard/server";
import { createClient } from "@the-vibe-company/openboard";
import { type BridgeOptions, createBridge, fileLinks } from "../src/main.ts";

const origin = "http://127.0.0.1:8787";
const target = "http://127.0.0.1:9000/board";

function board(webhookFetch: (request: Request) => Promise<Response>) {
  let time = 1_700_000_000_000;
  const now = () => time;
  const owner = mintLocalOwnerToken(new Uint8Array(42).fill(7));
  const store = sqliteDriver({ memory: true }, now);
  const wakes: Array<Parameters<Ports["jobs"]["watch"]>[2]> = [];
  let drawn = 0;
  let requests = 0;
  const app = createApp(
    {
      mode: "local",
      publicUrl: origin,
      localOwner: "ob:user:local-test",
      localOwnerTokenHash: owner.hash,
      secretKey: new Uint8Array(32).fill(12),
    },
    {
      store,
      jobs: {
        ...store.jobs,
        watch(_kinds, _schedule, wake) {
          wakes.push(wake);
          return () => {};
        },
      },
    },
    {
      now,
      requestId: () => `req-${++requests}`,
      randomBytes: (length) => new Uint8Array(length).fill(++drawn),
      log: { info: () => {}, error: () => {} },
      schedule: () => () => {},
      webhookFetch,
    },
  );
  return {
    address: { url: `${origin}/api/local/main`, fetch: app.fetch },
    client: createClient({ url: `${origin}/api/local/main`, token: owner.token, fetch: app.fetch }),
    now,
    advance: (ms: number) => {
      time += ms;
    },
    runJobs: () => Promise.all(wakes.map((wake) => wake())),
    close: app.close,
  };
}

function chatRequest(timestamp: number, id: string, key?: Uint8Array, user = "alice-7") {
  const body = JSON.stringify({ type: "chat.reply", thread: "chat-thread-1", user, text: "From chat" });
  const headers = new Headers({
    "webhook-id": id,
    "webhook-timestamp": String(timestamp / 1000),
  });
  if (key) {
    const signature = createHmac("sha256", key)
      .update(`${id}.${timestamp / 1000}.${body}`)
      .digest("base64");
    headers.set("webhook-signature", `v1,${signature}`);
  }
  return new Request("http://127.0.0.1:9000/chat", { method: "POST", headers, body });
}

test("bridges a signed support post and chat reply once across retries, rejecting unsigned and wrong signatures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openboard-chat-bridge-"));
  const delivered: Array<string | null> = [];
  const forwarded: Array<{ id: string | null; body: unknown }> = [];
  let receive: Awaited<ReturnType<typeof createBridge>>;
  const { client, address, now, advance, runJobs, close } = board(async (request) => {
    delivered.push(request.headers.get("webhook-id"));
    const status = (await receive(request)).status;
    // Lose the first acknowledgement after the bridge has committed the link.
    return new Response(null, { status: status === 204 && delivered.length === 1 ? 503 : status });
  });
  try {
    const { connection, secret: token } = await client.createConnection({
      name: "chat-bridge",
      can: { support: ["read", "post"] },
      direct: true,
      profiles: ["chat-*"],
    });
    const { secret } = await client.createWebhook({
      name: "chat-bridge",
      url: target,
      filter: { tail: "support", types: ["message.posted"] },
    });
    if (!secret) throw new Error("board did not issue a signing secret");
    const key = Buffer.alloc(32, 23);
    const options: BridgeOptions = {
      board: { ...address, token },
      boardSigningSecret: secret,
      platformSigningSecret: `whsec_${key.toString("base64")}`,
      platformUrl: "https://chat.example/incoming",
      links: fileLinks(join(dir, "links.json")),
      now,
      async platformFetch(url, init) {
        expect(url).toBe("https://chat.example/incoming");
        const request = new Request(url, init);
        forwarded.push({ id: request.headers.get("idempotency-key"), body: await request.json() });
        return Response.json({ thread: "chat-thread-1" });
      },
    };
    receive = await createBridge(options);
    const { message } = await client.postMessage({ channel: "support", text: "Board needs help" });
    await runJobs();
    expect(delivered).toHaveLength(1);
    const deliveryId = delivered[0];
    if (!deliveryId) throw new Error("board did not send a delivery ID");
    expect(deliveryId).toMatch(/^dl_/);
    expect(forwarded).toEqual([{ id: deliveryId, body: { boardThread: message.id, text: "Board needs help" } }]);

    receive = await createBridge(options);
    advance(10_000);
    await runJobs();
    expect(delivered).toEqual([deliveryId, deliveryId]);
    expect(forwarded).toHaveLength(1);

    expect((await receive(chatRequest(now(), "reply-1"))).status).toBe(401);
    expect((await receive(chatRequest(now(), "reply-1", Buffer.alloc(32, 24)))).status).toBe(401);
    expect((await receive(chatRequest(now(), "reply-1", key, "Alice-7"))).status).toBe(400);
    expect((await client.readThread({ id: message.id })).replies).toEqual([]);
    const replies = await Promise.all([
      receive(chatRequest(now(), "reply-1", key)),
      receive(chatRequest(now(), "reply-1", key)),
    ]);
    expect(replies.map(({ status }) => status)).toEqual([204, 204]);
    expect((await client.readThread({ id: message.id })).replies).toEqual([
      expect.objectContaining({
        re: message.id,
        text: "From chat",
        by: { principal: connection.principal, profile: "chat-alice-7", actor: `${connection.principal}+chat-alice-7` },
      }),
    ]);
    await runJobs();
    expect(forwarded).toHaveLength(1);
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});
