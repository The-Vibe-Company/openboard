import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { type App, DRAIN_TIMEOUT_MS, mintLocalOwnerToken } from "@openboard/server";
import { clientIp } from "./client-ip.ts";
import { compose } from "./compose.ts";
import type { Config } from "./config.ts";

const LOOPBACK = "127.0.0.1";

/**
 * Writes the owner token where `ob` looks for it, `~/.config/openboard/local/<port>.json`, readable by the user only
 * (docs/auth.md "Local mode"). The file is created 0600 under a temporary name, then renamed over any older one.
 */
async function writeTokenFile(port: number, url: string, token: string): Promise<void> {
  const dir = join(homedir(), ".config", "openboard", "local");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${port}.json`);
  const partial = `${file}.${process.pid}.tmp`;
  await writeFile(partial, `${JSON.stringify({ url, token })}\n`, { mode: 0o600, flag: "wx" });
  await rename(partial, file);
}

/** `ob serve`: binds locally or on all interfaces in hosted mode. */
export async function serve(config: Config): Promise<void> {
  const hostname = config.mode === "hosted" ? "0.0.0.0" : LOOPBACK;
  const owner = config.mode === "local" ? mintLocalOwnerToken(crypto.getRandomValues(new Uint8Array(42))) : undefined;
  const app = await compose(config, owner?.hash);
  try {
    const server = Bun.serve({
      hostname,
      port: config.port,
      fetch(request, server) {
        if (request.method === "GET" && /\/events\/*$/.test(new URL(request.url).pathname)) server.timeout(request, 0);
        return app.fetch(request, {
          ip: clientIp(request.headers, server.requestIP(request)?.address, config.trustedProxies),
        });
      },
    });
    try {
      if (owner) {
        const url = `http://${hostname}:${server.port}/api/local/main`;
        await writeTokenFile(server.port ?? config.port, url, owner.token);
        process.stdout.write(`BOARD_URL=${url}\n`);
      } else {
        process.stdout.write(`OpenBoard listening on http://${hostname}:${server.port} (hosted mode)\n`);
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
