import { statSync } from "node:fs";
import process from "node:process";

/** The server's configuration, parsed once at startup (docs/codebase.md 5.5). */
export interface Config {
  readonly port: number;
  /** `OPENBOARD_PUBLIC_URL`: the origin board URLs are built on, never `Host`; default `http://127.0.0.1:<port>`. */
  readonly publicUrl: string;
  readonly dataDir: string;
  readonly sync: "NORMAL" | "FULL";
  /** Who writes until credentials arrive: `ob:user:local-<os user>` (docs/auth.md "Local mode"). */
  readonly localOwner: string;
}

export class ConfigError extends Error {}

function validDataDir(path: string): boolean {
  if (!path.trim() || path.includes("\0")) return false;
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOTDIR") return false;
    throw error;
  }
}

/** An `http(s)` origin with nothing after it (a trailing `/` is allowed), as its canonical form; null otherwise. */
function publicOrigin(text: string): string | null {
  if (!URL.canParse(text)) return null;
  const url = new URL(text);
  const bare = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  return bare && (url.protocol === "http:" || url.protocol === "https:") ? url.origin : null;
}

/** The one place the server reads its environment; every bad variable is named, and the caller exits 2. */
export function loadConfig(env: Readonly<Record<string, string | undefined>> = process.env): Config {
  const problems: string[] = [];
  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) problems.push(`PORT: expected 1 to 65535, got ${env.PORT}`);
  if (env.OPENBOARD_DATABASE_URL) {
    problems.push("OPENBOARD_DATABASE_URL: hosted mode on Postgres is not built yet; unset it to run locally");
  }
  const publicUrl = publicOrigin(env.OPENBOARD_PUBLIC_URL ?? `http://127.0.0.1:${port}`);
  // Unset, it follows PORT, so a bad PORT is reported once, as itself.
  if (!publicUrl && env.OPENBOARD_PUBLIC_URL !== undefined)
    problems.push("OPENBOARD_PUBLIC_URL: expected an http or https origin, such as https://board.example");
  const dataDir = env.OPENBOARD_DATA_DIR ?? "./.openboard";
  if (!validDataDir(dataDir)) problems.push("OPENBOARD_DATA_DIR: expected a directory path");
  const sync = env.OPENBOARD_SYNC ?? "NORMAL";
  if (sync !== "NORMAL" && sync !== "FULL") problems.push("OPENBOARD_SYNC: expected NORMAL or FULL");
  const user = (env.USER ?? env.USERNAME ?? "owner").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (problems.length > 0 || !publicUrl) throw new ConfigError(problems.join("\n"));
  return Object.freeze({
    port,
    publicUrl,
    dataDir,
    sync: sync === "FULL" ? "FULL" : "NORMAL",
    localOwner: `ob:user:local-${user}`,
  });
}

/** The environment `ob`'s client commands read (`BOARD_URL`, `BOARD_TOKEN`), handed to `runCli`. */
export function clientEnvironment(): Readonly<Record<string, string | undefined>> {
  return process.env;
}
