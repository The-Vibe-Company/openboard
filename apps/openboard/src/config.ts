import { readFileSync, statSync } from "node:fs";
import process from "node:process";

/** The log levels `OPENBOARD_LOG_LEVEL` accepts (docs/codebase.md 5.4). */
const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
/** `OPENBOARD_SIGNUP` (docs/auth.md "Sign-in providers"); local mode has no sign-up unless it is set. */
const SIGNUP_MODES = ["open", "invite", "closed"] as const;
type Signup = (typeof SIGNUP_MODES)[number];

/** The server's configuration, parsed once at startup (docs/codebase.md 5.5). */
interface CommonConfig {
  readonly port: number;
  /** `OPENBOARD_PUBLIC_URL`: the origin board URLs are built on, never `Host`; default `http://127.0.0.1:<port>`. */
  readonly publicUrl: string;
  readonly dataDir: string;
  readonly sync: "NORMAL" | "FULL";
  /** Who writes until credentials arrive: `ob:user:local-<os user>` (docs/auth.md "Local mode"). */
  readonly localOwner: string;
  /** `OPENBOARD_SIGNUP`: whether a new sign-in identity makes a new person; default `closed`. */
  readonly signup: Signup;
  /** `OPENBOARD_GITHUB_CLIENT_ID` and `OPENBOARD_GITHUB_CLIENT_SECRET`: GitHub sign-in, when both are set. */
  readonly github?: { readonly clientId: string; readonly clientSecret: string };
}

export type Config = CommonConfig &
  ({ readonly mode: "local" } | { readonly mode: "hosted"; readonly databaseUrl: string });

export class ConfigError extends Error {}

function validDataDir(path: string): boolean {
  if (!path.trim() || path.includes("\0")) return false;
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? true;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ENOTDIR" || error.code === "EACCES" || error.code === "EPERM") return false;
    }
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

function validDatabaseUrl(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const url = new URL(text);
  return !!url.hostname && (url.protocol === "postgres:" || url.protocol === "postgresql:");
}

type Env = Readonly<Record<string, string | undefined>>;

/** A secret from `OPENBOARD_<NAME>` or the file `OPENBOARD_<NAME>_FILE` names, never both (docs/codebase.md 5.5). */
function secretOf(env: Env, name: string, problems: string[]): string | undefined {
  const value = env[name];
  const file = env[`${name}_FILE`];
  if (value !== undefined && file !== undefined) problems.push(`${name} and ${name}_FILE cannot both be set`);
  if (file === undefined) return value;
  try {
    return readFileSync(file, "utf8").trim();
  } catch (error) {
    if (!(error instanceof Error && "code" in error)) throw error;
    problems.push(`${name}_FILE: cannot read the file it names`);
    return undefined;
  }
}

/** GitHub sign-in's OAuth client: both halves or neither. */
function githubOf(env: Env, problems: string[]): Config["github"] {
  const clientId = env.OPENBOARD_GITHUB_CLIENT_ID;
  const clientSecret = secretOf(env, "OPENBOARD_GITHUB_CLIENT_SECRET", problems);
  if (clientId && clientSecret) return Object.freeze({ clientId, clientSecret });
  if (clientId || clientSecret) {
    problems.push("OPENBOARD_GITHUB_CLIENT_ID and OPENBOARD_GITHUB_CLIENT_SECRET: set both, or neither");
  }
  return undefined;
}

/** The one place the server reads its environment; every bad variable is named, and the caller exits 2. */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];
  if (env.OPENBOARD_SECRET_KEY !== undefined && env.OPENBOARD_SECRET_KEY_FILE !== undefined) {
    problems.push("OPENBOARD_SECRET_KEY and OPENBOARD_SECRET_KEY_FILE cannot both be set");
  }
  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) problems.push(`PORT: expected 1 to 65535, got ${env.PORT}`);
  const databaseUrl = secretOf(env, "OPENBOARD_DATABASE_URL", problems);
  if (databaseUrl !== undefined && !validDatabaseUrl(databaseUrl)) {
    const name =
      env.OPENBOARD_DATABASE_URL_FILE === undefined ? "OPENBOARD_DATABASE_URL" : "OPENBOARD_DATABASE_URL_FILE";
    problems.push(`${name}: expected a postgres or postgresql URL with a host`);
  }
  const publicUrl = publicOrigin(env.OPENBOARD_PUBLIC_URL ?? `http://127.0.0.1:${port}`);
  // Unset, it follows PORT, so a bad PORT is reported once, as itself.
  if (!publicUrl && env.OPENBOARD_PUBLIC_URL !== undefined)
    problems.push("OPENBOARD_PUBLIC_URL: expected an http or https origin, such as https://board.example");
  const dataDir = env.OPENBOARD_DATA_DIR ?? "./.openboard";
  if (databaseUrl === undefined && !validDataDir(dataDir))
    problems.push("OPENBOARD_DATA_DIR: expected a directory path");
  const sync = env.OPENBOARD_SYNC ?? "NORMAL";
  if (sync !== "NORMAL" && sync !== "FULL") problems.push("OPENBOARD_SYNC: expected NORMAL or FULL");
  const logLevel = env.OPENBOARD_LOG_LEVEL ?? "info";
  if (!(LOG_LEVELS as readonly string[]).includes(logLevel))
    problems.push(`OPENBOARD_LOG_LEVEL: expected ${LOG_LEVELS.join(", ")}, got ${logLevel}`);
  const signup = env.OPENBOARD_SIGNUP ?? "closed";
  if (!(SIGNUP_MODES as readonly string[]).includes(signup))
    problems.push(`OPENBOARD_SIGNUP: expected ${SIGNUP_MODES.join(", ")}, got ${signup}`);
  const github = githubOf(env, problems);
  const user = (env.USER ?? env.USERNAME ?? "owner").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (problems.length > 0 || !publicUrl) throw new ConfigError(problems.join("\n"));
  return Object.freeze({
    ...(databaseUrl === undefined ? { mode: "local" as const } : { mode: "hosted" as const, databaseUrl }),
    port,
    publicUrl,
    dataDir,
    sync: sync === "FULL" ? "FULL" : "NORMAL",
    localOwner: `ob:user:local-${user}`,
    signup: signup as Signup,
    ...(github && { github }),
  });
}

/** The environment `ob`'s client commands read (`BOARD_URL`, `BOARD_TOKEN`), handed to `runCli`. */
export function clientEnvironment(): Readonly<Record<string, string | undefined>> {
  return process.env;
}
