import { createHmac } from "node:crypto";

// Loopback-only adapter for the README smoke test.
const secretFile = Bun.env.OPENBOARD_CHAT_SECRET_FILE;
if (!secretFile) throw new Error("Set OPENBOARD_CHAT_SECRET_FILE");
const key = Buffer.from((await Bun.file(secretFile).text()).trim().slice("whsec_".length), "base64");
const threads = new Map<string, string>();
const bridge = `http://127.0.0.1:${Bun.env.OPENBOARD_BRIDGE_PORT ?? 9000}/chat`;

function reply(thread: string) {
  const body = JSON.stringify({ type: "chat.reply", thread, user: "alice-7", text: "Reply from chat" });
  const id = `reply-${thread}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return fetch(bridge, {
    method: "POST",
    headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` },
    body,
  });
}

Bun.serve({
  hostname: "127.0.0.1",
  port: 9001,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (pathname === "/incoming") {
      const id = request.headers.get("idempotency-key");
      if (!id) return new Response(null, { status: 400 });
      const existing = threads.get(id);
      if (existing) return Response.json({ thread: existing });
      const { boardThread } = (await request.json()) as { boardThread: string };
      const thread = `chat-${boardThread}`;
      threads.set(id, thread);
      console.log(`Received board thread #${boardThread} as ${thread}`);
      return Response.json({ thread });
    }
    if (pathname.startsWith("/reply/")) {
      const thread = pathname.slice("/reply/".length);
      if (![...threads.values()].includes(thread)) return new Response(null, { status: 404 });
      return reply(thread);
    }
    return new Response(null, { status: 404 });
  },
});
console.log("Fake platform listening on 127.0.0.1:9001");
