import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin } from "node:process";
import { BoardError } from "@the-vibe-company/openboard";

export type CliEnvironment = Readonly<Record<string, string | undefined>>;

type AgentConfig = { readonly boardUrl: string; readonly token: string; readonly profile: string };
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** A token file that is missing or that this user cannot read is no token: the request goes without one. */
const UNREADABLE = new Set(["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"]);

export function agentConfigPath(env: CliEnvironment): string | undefined {
  return env.HOME ? join(env.HOME, ".config", "openboard", "agent.json") : undefined;
}

export function boardAddress(address: string | undefined): string | undefined {
  const url = URL.parse(address ?? "");
  if (!url || url.username || url.password || /[?#]/.test(url.href)) return undefined;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) return undefined;
  if (LOOPBACK.has(url.hostname) && /^\/api\/*$/.test(url.pathname)) url.pathname = "/api/local/main";
  return url.href.replace(/\/+$/, "");
}

function storedAgent(env: CliEnvironment): AgentConfig | undefined {
  const path = agentConfigPath(env);
  if (!path) return undefined;
  try {
    const saved = JSON.parse(readFileSync(path, "utf8")) as Partial<AgentConfig> | null;
    if (!saved || typeof saved.boardUrl !== "string" || boardAddress(saved.boardUrl) !== saved.boardUrl)
      return undefined;
    if (
      typeof saved.token !== "string" ||
      !isAgentToken(saved.token) ||
      typeof saved.profile !== "string" ||
      !saved.profile
    )
      return;
    return { boardUrl: saved.boardUrl, token: saved.token, profile: saved.profile };
  } catch (error) {
    if (error instanceof SyntaxError || UNREADABLE.has((error as NodeJS.ErrnoException).code ?? "")) return undefined;
    throw new BoardError("invalid_request", "could not read the stored agent credential");
  }
}

export function connectionSecret(
  env: CliEnvironment,
  file: string | undefined,
  readStdin = () => (stdin.isTTY ? "" : readFileSync(0, "utf8")),
): string {
  if (env.OPENBOARD_SECRET !== undefined && env.OPENBOARD_SECRET_FILE !== undefined) {
    throw new BoardError("invalid_request", "set only one of OPENBOARD_SECRET and OPENBOARD_SECRET_FILE");
  }
  const path = file ?? env.OPENBOARD_SECRET_FILE;
  let raw: string;
  try {
    raw = path === undefined ? (env.OPENBOARD_SECRET ?? readStdin()) : readFileSync(path, "utf8");
  } catch {
    throw new BoardError(
      "invalid_request",
      path === undefined ? "could not read stdin" : "could not read the secret file",
    );
  }
  const secret = raw.trim();
  if (!secret || /[^!-~]/.test(secret)) throw new BoardError("invalid_request", "provide a single connection secret");
  return secret;
}

/** The agent credential format in docs/auth.md. */
export function isAgentToken(token: unknown): token is string {
  return typeof token === "string" && /^obt_[a-z2-7]{16}_[A-Za-z0-9_-]{43}$/.test(token);
}

/** Prepare private storage before claiming, then atomically replace the active identity on success. */
export async function storeAgentClaim(
  path: string,
  context: Omit<AgentConfig, "token">,
  claimToken: () => Promise<string>,
): Promise<void> {
  const dir = dirname(path);
  let temp: string | undefined;
  try {
    let file: string;
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const existing = lstatSync(path, { throwIfNoEntry: false });
      if (existing && !existing.isFile()) throw new Error("credential destination is not a file");
      temp = mkdtempSync(join(dir, ".agent-"));
      file = join(temp, "credential");
      writeFileSync(file, "", { mode: 0o600, flag: "wx" });
    } catch {
      throw new BoardError("invalid_request", "could not prepare agent credential storage");
    }
    const token = await claimToken();
    try {
      writeFileSync(file, JSON.stringify({ ...context, token }));
      renameSync(file, path);
    } catch {
      throw new BoardError("invalid_request", "the agent was claimed but its credential could not be stored");
    }
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

/** What `ob`'s client commands read from the environment: upstream's `BOARD_URL`, `BOARD_TOKEN` and `BOARD_PROFILE`. */
export interface ClientConfig {
  readonly boardUrl: string | undefined;
  readonly token: string | undefined;
  readonly profile: string | undefined;
}

/** The token `ob serve` wrote for a loopback `BOARD_URL`'s port, from `~/.config/openboard/local/<port>.json`. */
function localOwnerToken(boardUrl: string | undefined, home: string | undefined): string | undefined {
  const url = URL.parse(boardUrl ?? "");
  const port = localPort(url);
  if (!home || !port) return undefined;
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

/** The loopback owner credential is keyed by port even across alternate loopback hostnames. */
function localPort(url: URL | null): string | undefined {
  if (!url || !LOOPBACK.has(url.hostname)) return undefined;
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

/** Resolves one board and credential together, then falls back to the local owner when applicable. */
export function clientConfig(env: CliEnvironment): ClientConfig {
  const explicitUrl = env.BOARD_URL || undefined;
  const profile = env.BOARD_PROFILE || undefined;
  if (env.BOARD_TOKEN) return { boardUrl: explicitUrl, token: env.BOARD_TOKEN, profile };

  const saved = storedAgent(env);
  if (saved && (!explicitUrl || boardAddress(explicitUrl) === saved.boardUrl)) {
    return { ...saved, profile: profile ?? saved.profile };
  }
  const savedPort = localPort(URL.parse(saved?.boardUrl ?? ""));
  const sameOwner = savedPort !== undefined && savedPort === localPort(URL.parse(explicitUrl ?? ""));
  const token = sameOwner ? undefined : localOwnerToken(explicitUrl, env.HOME || undefined);
  return { boardUrl: explicitUrl, token, profile };
}
