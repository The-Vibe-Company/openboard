import { readFileSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import process from "node:process";

/** The log levels `OPENBOARD_LOG_LEVEL` accepts (docs/codebase.md 5.4). */
const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
/** `OPENBOARD_SIGNUP` (docs/auth.md "Sign-in providers"); local mode has no sign-up unless it is set. */
const SIGNUP_MODES = ["open", "invite", "closed"] as const;
type Signup = (typeof SIGNUP_MODES)[number];

/** The server's configuration, parsed once at startup (docs/codebase.md 5.5). */
interface CommonConfig {
  readonly webhookCustomSigning: boolean;
  readonly webhookTargets: { readonly hosts: readonly string[]; readonly ports: readonly number[] };
  readonly docker: boolean;
  readonly secretKey?: Uint8Array;
  readonly secretKeyFile?: string;
  readonly host: string;
  readonly port: number;
  /** Number of trusted reverse proxy hops in front of this listener. */
  readonly trustedProxies: number;
  readonly instanceId?: string;
  readonly deploymentTag?: string;
  /** `OPENBOARD_PUBLIC_URL`: the origin board URLs are built on, never `Host`; default `http://127.0.0.1:<port>`. */
  readonly publicUrl: string;
  readonly dataDir: string;
  readonly sync: "NORMAL" | "FULL";
  /** Who writes until credentials arrive: `ob:user:local-<os user>` (docs/auth.md "Local mode"). */
  readonly localOwner: string;
  /** `OPENBOARD_SIGNUP`: whether a new sign-in identity makes a new person; default `closed`. */
  readonly signup: Signup;
  readonly backup?: BackupConfig;
  /** `OPENBOARD_GITHUB_CLIENT_ID` and `OPENBOARD_GITHUB_CLIENT_SECRET`: GitHub sign-in, when both are set. */
  readonly github?: { readonly clientId: string; readonly clientSecret: string };
}

export interface BackupConfig {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
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

function backupOf(env: Env, problems: string[]): BackupConfig | undefined {
  const prefix = "OPENBOARD_BACKUP_S3_";
  const endpoint = env[`${prefix}ENDPOINT`];
  const bucket = env[`${prefix}BUCKET`];
  const region = env[`${prefix}REGION`];
  const accessKeyId = env[`${prefix}ACCESS_KEY_ID`];
  const secretAccessKey = secretOf(env, `${prefix}SECRET_ACCESS_KEY`, problems);
  if (
    [endpoint, bucket, region, accessKeyId, secretAccessKey, env[`${prefix}SECRET_ACCESS_KEY_FILE`]].every(
      (value) => value === undefined,
    )
  )
    return undefined;
  if (!endpoint || !bucket?.trim() || !region?.trim() || !accessKeyId?.trim() || !secretAccessKey?.trim()) {
    problems.push(
      ["ENDPOINT", "BUCKET", "REGION", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"].map((name) => prefix + name).join(", ") +
        ": set all five, or none",
    );
    return undefined;
  }
  const origin = publicOrigin(endpoint);
  if (!origin) {
    problems.push(`${prefix}ENDPOINT: expected an http or https origin`);
    return undefined;
  }
  return Object.freeze({ endpoint: origin, bucket, region, accessKeyId, secretAccessKey });
}

function webhookKeyOf(env: Env, problems: string[]): Uint8Array | undefined {
  if (env.OPENBOARD_SECRET_KEY !== undefined && env.OPENBOARD_SECRET_KEY_FILE !== undefined) {
    problems.push("OPENBOARD_SECRET_KEY and OPENBOARD_SECRET_KEY_FILE cannot both be set");
    return undefined;
  }
  const text = secretOf(env, "OPENBOARD_SECRET_KEY", problems);
  if (text === undefined) return undefined;
  if (!/^(?:[A-Za-z0-9+/]{43}|[A-Za-z0-9_-]{43})=?$/.test(text)) {
    problems.push("OPENBOARD_SECRET_KEY: expected 32 bytes encoded as base64 or base64url");
    return undefined;
  }
  return Buffer.from(text, "base64");
}

function webhookTargetsOf(env: Env, problems: string[]): Config["webhookTargets"] {
  const hosts =
    env.OPENBOARD_WEBHOOK_ALLOWED_HOSTS?.split(",").map((host) => host.trim().toLowerCase().replace(/\.$/, "")) ?? [];
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (
    hosts.some(
      (host) =>
        host.length > 253 ||
        !host.split(".").every((part) => label.test(part)) ||
        URL.parse(`https://${host}`)?.hostname !== host,
    )
  ) {
    problems.push("OPENBOARD_WEBHOOK_ALLOWED_HOSTS: expected comma-separated exact hostnames");
  }
  const ports = env.OPENBOARD_WEBHOOK_ALLOWED_PORTS?.split(",").map((port) => port.trim()) ?? [];
  if (ports.some((port) => !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65_535)) {
    problems.push("OPENBOARD_WEBHOOK_ALLOWED_PORTS: expected comma-separated ports from 1 to 65535");
  }
  return Object.freeze({ hosts: Object.freeze(hosts), ports: Object.freeze(ports.map(Number)) });
}

/** The one place the server reads its environment; every bad variable is named, and the caller exits 2. */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];
  const customSigning = env.OPENBOARD_WEBHOOK_CUSTOM_SIGNING ?? "off";
  if (customSigning !== "on" && customSigning !== "off")
    problems.push("OPENBOARD_WEBHOOK_CUSTOM_SIGNING: expected on or off");
  const webhookTargets = webhookTargetsOf(env, problems);
  const secretKey = webhookKeyOf(env, problems);
  const docker = env.OPENBOARD_DOCKER ?? "off";
  if (docker !== "on" && docker !== "off") problems.push("OPENBOARD_DOCKER: expected on or off");
  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) problems.push(`PORT: expected 1 to 65535, got ${env.PORT}`);
  const proxyHops = env.OPENBOARD_TRUSTED_PROXIES;
  const trustedProxies = proxyHops === undefined ? 0 : Number(proxyHops);
  if (
    proxyHops !== undefined &&
    (!/^\d+$/.test(proxyHops) || !Number.isSafeInteger(trustedProxies) || trustedProxies < 1)
  ) {
    problems.push("OPENBOARD_TRUSTED_PROXIES: expected a positive integer");
  }
  const databaseUrl = secretOf(env, "OPENBOARD_DATABASE_URL", problems);
  if (databaseUrl !== undefined && !validDatabaseUrl(databaseUrl)) {
    const name =
      env.OPENBOARD_DATABASE_URL_FILE === undefined ? "OPENBOARD_DATABASE_URL" : "OPENBOARD_DATABASE_URL_FILE";
    problems.push(`${name}: expected a postgres or postgresql URL with a host`);
  }
  const host = env.OPENBOARD_HOST ?? (databaseUrl === undefined ? "127.0.0.1" : "0.0.0.0");
  if (!host || /\s/.test(host)) problems.push("OPENBOARD_HOST: expected a hostname or IP address");
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
  const backup = backupOf(env, problems);
  const github = githubOf(env, problems);
  const user = (env.USER ?? env.USERNAME ?? "owner").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (problems.length > 0 || !publicUrl) throw new ConfigError(problems.join("\n"));
  return Object.freeze({
    ...(databaseUrl === undefined ? { mode: "local" as const } : { mode: "hosted" as const, databaseUrl }),
    host,
    webhookTargets,
    docker: docker === "on",
    webhookCustomSigning: customSigning === "on",
    ...(secretKey && { secretKey }),
    ...(env.OPENBOARD_SECRET_KEY_FILE !== undefined && { secretKeyFile: env.OPENBOARD_SECRET_KEY_FILE }),
    port,
    trustedProxies,
    ...(env.OPENBOARD_INSTANCE_ID && { instanceId: env.OPENBOARD_INSTANCE_ID }),
    ...(env.OPENBOARD_DEPLOYMENT_TAG && { deploymentTag: env.OPENBOARD_DEPLOYMENT_TAG }),
    publicUrl,
    dataDir,
    sync: sync === "FULL" ? "FULL" : "NORMAL",
    localOwner: `ob:user:local-${user}`,
    signup: signup as Signup,
    ...(github && { github }),
    ...(backup && { backup }),
  });
}

export function operatorName(env: Env = process.env): string {
  return env.OPENBOARD_OPERATOR?.trim() || userInfo().username;
}

/** The environment `ob`'s client commands read (`BOARD_URL`, `BOARD_TOKEN`), handed to `runCli`. */
export function clientEnvironment(): Readonly<Record<string, string | undefined>> {
  return process.env;
}
