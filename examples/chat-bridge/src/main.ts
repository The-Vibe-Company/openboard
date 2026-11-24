import { rename, writeFile } from "node:fs/promises";
import { createClient, type ClientOptions } from "@the-vibe-company/openboard";
import { createInbound } from "./inbound.ts";
import { createOutbound, record, type ThreadLink, type ThreadLinks } from "./outbound.ts";

export interface BridgeOptions {
  board: ClientOptions;
  boardSigningSecret: string;
  platformSigningSecret: string;
  platformUrl: string;
  links: ThreadLinks;
  now: () => number;
  platformFetch: (url: string, init: RequestInit) => Promise<Response>;
}

export async function createBridge(options: BridgeOptions) {
  const board: ClientOptions = {
    ...options.board,
    fetch: options.board.fetch ?? ((request) => globalThis.fetch(request, { redirect: "error" })),
  };
  const { principal, openboard } = await createClient({ ...board, profile: "chat-bridge" }).getMe(
    {},
    { signal: AbortSignal.timeout(5000) },
  );
  if (openboard.credential !== "connection") throw new Error("expected a direct board connection");
  const outbound = createOutbound(options.boardSigningSecret, options.now, options.links, async (id, payload) => {
    const response = await options.platformFetch(options.platformUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": id },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("platform rejected the thread");
    const result: unknown = await response.json();
    if (!record(result) || typeof result.thread !== "string" || !result.thread) {
      throw new Error("platform response is missing a thread ID");
    }
    return result.thread;
  });
  const inbound = createInbound(options.platformSigningSecret, options.now, options.links, principal, (profile) =>
    createClient({ ...board, profile }),
  );
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path !== "/board" && path !== "/chat") return new Response(null, { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    try {
      const status = await (path === "/board" ? outbound(request) : inbound(request));
      return new Response(null, { status });
    } catch {
      return new Response(null, { status: 503 });
    }
  };
}

export function fileLinks(path: string): ThreadLinks {
  return {
    async read() {
      try {
        return (await Bun.file(path).json()) as ThreadLink[];
      } catch (error) {
        if (record(error) && error.code === "ENOENT") return [];
        throw error;
      }
    },
    async save(links) {
      await writeFile(`${path}.tmp`, JSON.stringify(links), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    },
  };
}

function setting(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error("missing configuration");
  return value;
}

function endpoint(name: string): string {
  const url = new URL(setting(name));
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("invalid endpoint");
  return url.href;
}

async function serve() {
  const token = (await Bun.stdin.text()).trim();
  if (!token.startsWith("obc_")) throw new Error("expected a connection secret");
  const port = Number(Bun.env.OPENBOARD_BRIDGE_PORT ?? 9000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid port");
  const fetch = await createBridge({
    board: { url: endpoint("BOARD_URL"), token },
    boardSigningSecret: (await Bun.file(setting("OPENBOARD_WEBHOOK_SECRET_FILE")).text()).trim(),
    platformSigningSecret: (await Bun.file(setting("OPENBOARD_CHAT_SECRET_FILE")).text()).trim(),
    platformUrl: endpoint("OPENBOARD_CHAT_INCOMING_URL"),
    links: fileLinks(setting("OPENBOARD_BRIDGE_LINKS_FILE")),
    now: Date.now,
    platformFetch: globalThis.fetch,
  });
  Bun.serve({ hostname: "127.0.0.1", port, maxRequestBodySize: 256 * 1024, fetch });
  console.log(`Chat bridge listening on 127.0.0.1:${port}`);
}

if (import.meta.main) {
  await serve().catch(() => {
    console.error("error: startup_failed: check bridge environment, files, listener and connection secret on stdin");
    process.exitCode = 1;
  });
}
