import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { mintLocalOwnerToken } from "@openboard/server";
import type { Config } from "./config.ts";
import { compose } from "./compose.ts";

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

/** `ob serve`: the local board on loopback; prints its `BOARD_URL`, never its token, and runs until interrupted. */
export async function serve(config: Config): Promise<void> {
  const owner = mintLocalOwnerToken(crypto.getRandomValues(new Uint8Array(42)));
  const app = compose(config, owner.hash);
  const server = Bun.serve({ hostname: HOST, port: config.port, fetch: app.fetch });
  const url = `http://${HOST}:${server.port}/api/local/main`;
  await writeTokenFile(server.port ?? config.port, url, owner.token);
  process.stdout.write(`BOARD_URL=${url}\n`);
  const stop = async () => {
    await server.stop();
    await app.close();
    process.exit(130);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
