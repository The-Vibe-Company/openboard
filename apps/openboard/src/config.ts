import process from "node:process";

/** The server's configuration, parsed once at startup (docs/codebase.md 5.5). */
export interface Config {
  readonly port: number;
  /** Who writes until credentials arrive: `ob:user:local-<os user>` (docs/auth.md "Local mode"). */
  readonly localOwner: string;
}

export class ConfigError extends Error {}

/** The one place the server reads its environment; every bad variable is named, and the caller exits 2. */
export function loadConfig(env: Readonly<Record<string, string | undefined>> = process.env): Config {
  const problems: string[] = [];
  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) problems.push(`PORT: expected 1 to 65535, got ${env.PORT}`);
  if (env.OPENBOARD_DATABASE_URL) {
    problems.push("OPENBOARD_DATABASE_URL: hosted mode on Postgres is not built yet; unset it to run locally");
  }
  const user = (env.USER ?? env.USERNAME ?? "owner").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (problems.length > 0) throw new ConfigError(problems.join("\n"));
  return Object.freeze({ port, localOwner: `ob:user:local-${user}` });
}

/** The environment `ob`'s client commands read (`BOARD_URL`, `BOARD_TOKEN`), handed to `runCli`. */
export function clientEnvironment(): Readonly<Record<string, string | undefined>> {
  return process.env;
}
