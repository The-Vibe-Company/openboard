import process from "node:process";
import { BoardError, type ClientOptions, createClient, tail } from "@the-vibe-company/openboard";
import { Misuse, type StandaloneContext } from "./commands/index.ts";
import { type AnyCommand, commands } from "./commands/usage.ts";
import { clientConfig } from "./config.ts";
import { consoleOutput, type Output, printError } from "./output.ts";

export interface CliOptions {
  readonly output?: Output;
  readonly fetch?: (request: Request) => Promise<Response>;
  readonly wait?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly timeoutSignal?: (ms: number) => AbortSignal;
  readonly readStdin?: () => string;
  /** Aborted on Ctrl-C; by default, the process's next SIGINT. */
  readonly interrupt?: AbortSignal;
}

function find(words: readonly string[]): AnyCommand | undefined {
  return commands
    .filter((command) => command.words.every((word, at) => words[at] === word))
    .sort((a, b) => b.words.length - a.words.length)[0];
}

function usage(output: Output, problem: string): number {
  output.err(`error: invalid_request: ${problem}`);
  for (const command of commands) output.err(`  ${command.usage}`);
  return 2;
}

/** A signal aborted by the process's next SIGINT, so a command that runs until Ctrl-C can end and exit 130. */
function nextSigint(): { signal: AbortSignal; release(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  return { signal: controller.signal, release: () => process.off("SIGINT", abort) };
}

/** `--as <name>` before `--`, upstream's way to pick a profile on every command; the flags without it. */
function profileFlag(flags: readonly string[]): { profile?: string; rest: readonly string[] } | null {
  const at = flags.indexOf("--as");
  if (at < 0) return { rest: flags };
  const profile = flags[at + 1];
  if (profile === undefined || profile.startsWith("--") || flags.indexOf("--as", at + 1) >= 0) return null;
  return { profile, rest: [...flags.slice(0, at), ...flags.slice(at + 2)] };
}

/** `ob`'s client commands. Exit codes: 0 success, 1 error, 2 misuse, 130 interrupted (docs/codebase.md 5.3). */
export async function runCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  options: CliOptions = {},
): Promise<number> {
  const output = options.output ?? consoleOutput;
  const end = argv.indexOf("--");
  const picked = profileFlag(end < 0 ? argv : argv.slice(0, end));
  if (!picked) return usage(output, "--as takes one profile name: --as fixer-2");
  const flags = picked.rest;
  const json = flags.includes("--json");
  const commandWords = flags.filter((arg) => arg !== "--json");
  const words = [...commandWords, ...(end < 0 ? [] : argv.slice(end + 1))];
  const command = find(commandWords);
  if (!command) return usage(output, words.length === 0 ? "usage:" : `unknown command: ${words.join(" ")}`);
  if (end === -1 && words.length === command.words.length + 1 && words.at(-1) === "--help") {
    output.out(command.usage);
    return 0;
  }
  try {
    const optionsEnd = Math.max(0, commandWords.length - command.words.length);
    const args = words.slice(command.words.length);
    const context = { args, optionsEnd, json, output, profile: picked.profile };
    if ("standalone" in command) {
      const standalone: StandaloneContext = { ...context, env, options };
      return await command.run(standalone);
    }
    const config = clientConfig(env);
    const profile = picked.profile ?? config.profile;
    if (!config.boardUrl) return usage(output, "BOARD_URL is not set: point it at a board, as `ob serve` prints it");
    if (!/^https?:$/.test(URL.parse(config.boardUrl)?.protocol ?? "")) {
      return usage(output, "BOARD_URL is not an http(s) URL");
    }
    const connection: ClientOptions = {
      url: config.boardUrl,
      ...(config.token === undefined ? {} : { token: config.token }),
      ...(profile === undefined ? {} : { profile }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    };
    return await command.run({
      ...context,
      client: createClient(connection),
      tail: (input) => tail({ ...input, ...connection }),
      interrupt: () => (options.interrupt ? { signal: options.interrupt, release: () => {} } : nextSigint()),
      boardUrl: config.boardUrl,
      home: env.HOME,
      now: options.now ?? Date.now,
      timeoutSignal: options.timeoutSignal ?? AbortSignal.timeout,
    });
  } catch (error) {
    if (error instanceof Misuse) return usage(output, `${error.message}: ${command.usage}`);
    if (!(error instanceof BoardError)) throw error;
    printError(output, error);
    return 1;
  }
}
