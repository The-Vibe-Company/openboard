import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { mintLocalOwnerToken } from "@openboard/server";
import { compose } from "./compose.ts";
import type { Config } from "./config.ts";

const HOST = "127.0.0.1";

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

/** `ob serve`: listens on loopback and runs until interrupted. */
export async function serve(config: Config): Promise<void> {
  const owner = config.mode === "local" ? mintLocalOwnerToken(crypto.getRandomValues(new Uint8Array(42))) : undefined;
  const app = await compose(config, owner?.hash);
  try {
    const server = Bun.serve({
      hostname: HOST,
      port: config.port,
      fetch(request, server) {
        if (request.method === "GET" && /\/events\/*$/.test(new URL(request.url).pathname)) server.timeout(request, 0);
        return app.fetch(request);
      },
    });
    try {
      if (owner) {
        const url = `http://${HOST}:${server.port}/api/local/main`;
        await writeTokenFile(server.port ?? config.port, url, owner.token);
        process.stdout.write(`BOARD_URL=${url}\n`);
      } else {
        process.stdout.write(`OpenBoard listening on http://${HOST}:${server.port} (hosted mode)\n`);
      }
    } catch (error) {
      await server.stop();
      throw error;
    }
    registerShutdown(server, app.close);
  } catch (error) {
    await app.close();
    throw error;
  }
}

function registerShutdown(server: { stop(): Promise<void> }, close: () => Promise<void>): void {
  const stop = async () => {
    await server.stop();
    await close();
    process.exit(130);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
