import { readFileSync } from "node:fs";
import { join } from "node:path";

/** What `ob`'s client commands read from the environment: upstream's `BOARD_URL`, `BOARD_TOKEN` and `BOARD_PROFILE`. */
export interface ClientConfig {
  readonly boardUrl: string | undefined;
  readonly token: string | undefined;
  readonly profile: string | undefined;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** A token file that is missing or that this user cannot read is no token: the request goes without one. */
const UNREADABLE = new Set(["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"]);

/** The token `ob serve` wrote for a loopback `BOARD_URL`'s port, from `~/.config/openboard/local/<port>.json`. */
function localOwnerToken(boardUrl: string | undefined, home: string | undefined): string | undefined {
  const url = URL.parse(boardUrl ?? "");
  if (!home || !url || !LOOPBACK.has(url.hostname)) return undefined;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  let text: string;
  try {
    text = readFileSync(join(home, ".config", "openboard", "local", `${port}.json`), "utf8");
  } catch (error) {
    if (UNREADABLE.has((error as NodeJS.ErrnoException).code ?? "")) return undefined;
    throw error;
  }
  try {
    const token: unknown = (JSON.parse(text) as { token?: unknown } | null)?.token;
    return typeof token === "string" && token !== "" ? token : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/**
 * The only place the CLI reads its environment (docs/codebase.md 5.5); `env` is handed in by the caller. Without
 * `BOARD_TOKEN`, a loopback board's local owner token is read from the file `ob serve` wrote (docs/auth.md).
 */
export function clientConfig(env: Readonly<Record<string, string | undefined>>): ClientConfig {
  const boardUrl = env.BOARD_URL || undefined;
  const token = env.BOARD_TOKEN || localOwnerToken(boardUrl, env.HOME || undefined);
  return { boardUrl, token, profile: env.BOARD_PROFILE || undefined };
}
