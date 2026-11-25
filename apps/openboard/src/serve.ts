import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { type App, DRAIN_TIMEOUT_MS, mintLocalOwnerToken } from "@openboard/server";
import { clientIp } from "./client-ip.ts";
import { compose } from "./compose.ts";
import type { Config } from "./config.ts";
import { serveSecretKey } from "./local-secret-key.ts";

/**
 * Writes the owner token where `ob` looks for it, `~/.config/openboard/local/<port>.json`, readable by the user only
 * (docs/auth.md "Local mode"). The file is created 0600 under a temporary name, then renamed over any older one.
 */
async function writeTokenFile(port: number, url: string, token: string): Promise<void> {
  const dir = join(homedir(), ".config", "openboard", "local");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(dir, ".owner-"));
  try {
    const partial = join(temp, "token");
    await writeFile(partial, `${JSON.stringify({ url, token })}\n`, { mode: 0o600, flag: "wx" });
    await rename(partial, join(dir, `${port}.json`));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/** `ob serve`: starts the configured listener and writes the local owner credential. */
export async function serve(config: Config): Promise<void> {
  const secretKey = await serveSecretKey(config, homedir());
  const owner = config.mode === "local" ? mintLocalOwnerToken(crypto.getRandomValues(new Uint8Array(42))) : undefined;
  const app = await compose(secretKey ? { ...config, secretKey } : config, owner?.hash);
  try {
    const server = Bun.serve({
      hostname: config.host,
      port: config.port,
      maxRequestBodySize: 8 * 1024 * 1024,
      fetch(request, server) {
        const { pathname } = new URL(request.url);
        if (
          (request.method === "GET" && /\/events\/*$/.test(pathname)) ||
          (request.method === "POST" && /\/tasks\/claim\/*$/.test(pathname))
        )
          server.timeout(request, 0);
        // MCP tools can wait for up to 25 seconds on the shared board pipeline (D28).
        if (request.method === "POST" && /^\/mcp(?:\/|$)/.test(pathname)) server.timeout(request, 30);
        // Leave time for the database write and the response around Resend's ten-second deadline.
        if (config.resend && request.method === "POST" && /^\/api\/x\/orgs\/[^/]+\/invitations\/*$/.test(pathname))
          server.timeout(request, 20);
        return app.fetch(request, {
          ip: clientIp(request.headers, server.requestIP(request)?.address, config.trustedProxies),
        });
      },
    });
    try {
      if (owner) {
        const url = new URL("/api/local/main", server.url);
        if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
        if (url.hostname === "[::]") url.hostname = "[::1]";
        await writeTokenFile(server.port ?? config.port, url.href, owner.token);
        process.stdout.write(`BOARD_URL=${url.href}\n`);
      } else {
        process.stdout.write(`OpenBoard listening on ${server.url.origin} (hosted mode)\n`);
      }
    } catch (error) {
      await server.stop();
      throw error;
    }
    registerShutdown(server, app);
  } catch (error) {
    await app.close();
    throw error;
  }
}

function registerShutdown(server: { stop(): Promise<void> }, app: App): void {
  let stopping = false;
  const stop = async (code: number) => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), DRAIN_TIMEOUT_MS);
    try {
      await Promise.all([server.stop(), app.drain()]);
      await app.close();
    } catch {
      code = 1;
    } finally {
      clearTimeout(deadline);
      process.exit(code);
    }
  };
  process.on("SIGINT", () => void stop(130));
  process.on("SIGTERM", () => void stop(0));
}
