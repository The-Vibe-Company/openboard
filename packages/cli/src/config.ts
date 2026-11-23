import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { stdin } from "node:process";
import { BoardError } from "@the-vibe-company/openboard";

export type CliEnvironment = Readonly<Record<string, string | undefined>>;

type AgentConfig = { readonly boardUrl: string; readonly token: string; readonly profile: string };
type PersonalContext = { readonly origin: string; readonly org: string; readonly board: string };
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** A token file that is missing or that this user cannot read is no token: the request goes without one. */
const UNREADABLE = new Set(["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"]);

export function agentConfigPath(env: CliEnvironment): string | undefined {
  return env.HOME ? join(env.HOME, ".config", "openboard", "agent.json") : undefined;
}

export function personalConfigPath(env: CliEnvironment): string | undefined {
  return env.HOME ? join(env.HOME, ".config", "openboard", "personal.json") : undefined;
}

export function loginOrigin(address: string | undefined): string | undefined {
  const safe = boardAddress(address);
  const url = URL.parse(safe ?? "");
  return url?.pathname === "/" ? url.origin : undefined;
}

export function isPersonalToken(token: unknown): token is string {
  return typeof token === "string" && /^obp_[a-z2-7]{16}_[A-Za-z0-9_-]{43}$/.test(token);
}

/** Bind the credential and its activation time to the same file even across an atomic replacement. */
function readSavedFile(path: string): { text: string; savedAt: bigint } {
  const fd = openSync(path, "r");
  try {
    return { text: readFileSync(fd, "utf8"), savedAt: fstatSync(fd, { bigint: true }).mtimeNs };
  } finally {
    closeSync(fd);
  }
}

function storedPersonal(env: CliEnvironment) {
  const path = personalConfigPath(env);
  if (!path) return undefined;
  try {
    const { text, savedAt } = readSavedFile(path);
    const saved = JSON.parse(text) as Partial<PersonalContext & { token: string }> | null;
    if (
      !saved ||
      typeof saved.origin !== "string" ||
      loginOrigin(saved.origin) !== saved.origin ||
      !isPersonalToken(saved.token) ||
      typeof saved.org !== "string" ||
      !SLUG.test(saved.org) ||
      typeof saved.board !== "string" ||
      !SLUG.test(saved.board)
    )
      return undefined;
    return { boardUrl: `${saved.origin}/api/${saved.org}/${saved.board}`, token: saved.token, savedAt };
  } catch (error) {
    if (error instanceof SyntaxError || UNREADABLE.has((error as NodeJS.ErrnoException).code ?? "")) return undefined;
    throw new BoardError("invalid_request", "could not read the stored personal credential");
  }
}

export function boardAddress(address: string | undefined): string | undefined {
  const url = URL.parse(address ?? "");
  if (!url || url.username || url.password || /[?#]/.test(url.href)) return undefined;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) return undefined;
  if (LOOPBACK.has(url.hostname) && /^\/api\/*$/.test(url.pathname)) url.pathname = "/api/local/main";
  return url.href.replace(/\/+$/, "");
}

function storedAgent(env: CliEnvironment) {
  const path = agentConfigPath(env);
  if (!path) return undefined;
  try {
    const { text, savedAt } = readSavedFile(path);
    const saved = JSON.parse(text) as Partial<AgentConfig> | null;
    if (!saved || typeof saved.boardUrl !== "string" || boardAddress(saved.boardUrl) !== saved.boardUrl)
      return undefined;
    if (
      typeof saved.token !== "string" ||
      !isAgentToken(saved.token) ||
      typeof saved.profile !== "string" ||
      !saved.profile
    )
      return;
    return { boardUrl: saved.boardUrl, token: saved.token, profile: saved.profile, savedAt };
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
  await storeCredential(path, "agent", async () => ({
    credential: { ...context, token: await claimToken() },
    result: undefined,
  }));
}

export async function storePersonalLogin<T>(
  path: string,
  login: () => Promise<{ credential: PersonalContext & { token: string }; result: T }>,
): Promise<T> {
  return storeCredential(path, "personal", login);
}

async function storeCredential<T>(
  path: string,
  kind: "agent" | "personal",
  obtain: () => Promise<{ credential: object; result: T }>,
): Promise<T> {
  const dir = dirname(path);
  let temp: string | undefined;
  try {
    let file: string;
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const existing = lstatSync(path, { throwIfNoEntry: false });
      if (existing && !existing.isFile()) throw new Error("credential destination is not a file");
      temp = mkdtempSync(join(dir, `.${kind}-`));
      file = join(temp, "credential");
      writeFileSync(file, "", { mode: 0o600, flag: "wx" });
    } catch {
      throw new BoardError("invalid_request", `could not prepare ${kind} credential storage`);
    }
    const { credential, result } = await obtain();
    try {
      writeFileSync(file, JSON.stringify(credential));
      renameSync(file, path);
    } catch {
      throw new BoardError(
        "invalid_request",
        kind === "agent"
          ? "the agent was claimed but its credential could not be stored"
          : "could not store the personal credential",
      );
    }
    return result;
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

  const personal = storedPersonal(env);
  const agent = storedAgent(env);
  const explicitBoard = boardAddress(explicitUrl);
  const agentMatch = agent && (!explicitUrl || explicitBoard === agent.boardUrl) ? agent : undefined;
  const personalMatch = personal && (!explicitUrl || explicitBoard === personal.boardUrl) ? personal : undefined;
  if (personalMatch && (!agentMatch || personalMatch.savedAt > agentMatch.savedAt)) {
    return { boardUrl: personalMatch.boardUrl, token: personalMatch.token, profile };
  }
  if (agentMatch) {
    return { boardUrl: agentMatch.boardUrl, token: agentMatch.token, profile: profile ?? agentMatch.profile };
  }
  const savedPort = localPort(URL.parse(agent?.boardUrl ?? ""));
  const sameOwner = savedPort !== undefined && savedPort === localPort(URL.parse(explicitUrl ?? ""));
  const token = sameOwner ? undefined : localOwnerToken(explicitUrl, env.HOME || undefined);
  return { boardUrl: explicitUrl, token, profile };
}
