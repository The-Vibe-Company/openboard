import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { BoardError } from "@openboard/contract";
import type { Client, ClientOptions } from "@the-vibe-company/openboard";
import { derivedCommands } from "./commands/derived.ts";
import { type CommandContext, Misuse, type StandaloneContext } from "./commands/index.ts";
import { handwrittenCommands } from "./commands/reference/registry.ts";
import { completion, shells } from "./commands/utility/completion.ts";
import { showHelp, utilityCommands } from "./commands/utility/help.ts";
import { clientConfig } from "./config.ts";
import { consoleOutput, type Output, printError, setupHint } from "./output.ts";
import { version } from "./version.ts";

export { clientEnvironment } from "./config.ts";

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

const commands = [...handwrittenCommands, ...derivedCommands];
type AnyCommand = (typeof commands)[number];

function find(words: readonly string[]): AnyCommand | undefined {
  // A schedule with timing flags may target the channel named "cancel".
  if (
    words[0] === "schedule" &&
    words[1] === "cancel" &&
    words.slice(2).some((word) => word === "--in" || word === "--at" || word === "--every")
  ) {
    return handwrittenCommands.find((command) => command.words.join(" ") === "schedule");
  }
  return commands
    .filter((command) => command.words.every((word, at) => words[at] === word))
    .sort((a, b) => b.words.length - a.words.length)[0];
}

function usage(output: Output, problem: string, next?: string): number {
  output.err(`error: invalid_request: ${problem}`);
  if (next) output.err(`Next step: ${next}`);
  output.err("Use ob help to list commands.");
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
  if (end < 0 && words.length === 1 && (words[0] === "--version" || words[0] === "-V")) {
    output.out(`ob ${version}`);
    return 0;
  }
  const helpFlag = end < 0 && (words.at(-1) === "--help" || words.at(-1) === "-h");
  const utility = utilityCommands.find(({ words: [name] }) => commandWords[0] === name);
  const command = utility ?? find(commandWords);
  if (words.length === 0 || (helpFlag && words.length === 1)) return showHelp(output, []);
  if (helpFlag && command && words.length === command.words.length + 1) {
    return showHelp(output, words.slice(0, -1));
  }
  if (helpFlag && words[0] === "help") return showHelp(output, words.slice(1, -1));
  if (!command) return usage(output, `unknown command: ${words.join(" ")}`);
  try {
    const optionsEnd = Math.max(0, commandWords.length - command.words.length);
    const args = words.slice(command.words.length);
    const context = { args, optionsEnd, json, output, profile: picked.profile };
    if (!("run" in command)) return await runUtility(command.words[0], { ...context, env, options });
    if ("standalone" in command) return await command.run({ ...context, env, options });
    const config = clientConfig(env);
    const profile = picked.profile ?? config.profile;
    if (!config.boardUrl) {
      return usage(
        output,
        "BOARD_URL is not set: point it at a board, as `ob serve` prints it",
        json ? undefined : setupHint,
      );
    }
    if (!/^https?:$/.test(URL.parse(config.boardUrl)?.protocol ?? "")) {
      return usage(output, "BOARD_URL is not an http(s) URL");
    }
    const connection: ClientOptions = {
      url: config.boardUrl,
      ...(config.token === undefined ? {} : { token: config.token }),
      ...(profile === undefined ? {} : { profile }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    };
    const code = await command.run({
      ...context,
      ...lazyBoard(connection),
      interrupt: () => (options.interrupt ? { signal: options.interrupt, release: () => {} } : nextSigint()),
      boardUrl: config.boardUrl,
      home: env.HOME,
      now: options.now ?? Date.now,
      wait: options.wait ?? setTimeout,
      timeoutSignal: options.timeoutSignal ?? AbortSignal.timeout,
    });
    // A blocked stdout write can keep the process alive after the SIGINT handler finishes.
    if (json && code === 130 && !options.interrupt && !options.output && process.stdout.writableLength)
      process.exit(code);
    return code;
  } catch (error) {
    if (error instanceof Misuse) return usage(output, `${error.message}: ${command.usage}`);
    if (
      !(error instanceof BoardError) &&
      !(error instanceof (await import("@the-vibe-company/openboard")).BoardError)
    ) {
      throw error;
    }
    printError(output, error, {
      json,
      boardCommand: !("standalone" in command) && "run" in command ? command.words.join(" ") : undefined,
    });
    return 1;
  }
}

async function runUtility(name: (typeof utilityCommands)[number]["words"][0], ctx: StandaloneContext): Promise<number> {
  if (name === "help") return showHelp(ctx.output, ctx.args);
  if (name === "doctor") return (await import("./commands/utility/doctor.ts")).doctor(ctx);
  const shell = shells.find((value) => ctx.args[0] === value);
  if (!shell || ctx.args.length !== 1) throw new Misuse("choose bash, zsh or fish");
  ctx.output.out(completion(shell, [...commands, ...utilityCommands]));
  return 0;
}

/** The command can validate arguments before opening the SDK or creating its client. */
function lazyBoard(connection: ClientOptions): Pick<CommandContext, "client" | "tail"> {
  let client: Promise<Client> | undefined;
  return {
    client: new Proxy({} as Client, {
      get:
        (_, method: keyof Client) =>
        async (...args: unknown[]) => {
          client ??= import("@the-vibe-company/openboard").then(({ createClient }) => createClient(connection));
          const invoke = (await client)[method] as (...args: unknown[]) => Promise<unknown>;
          return invoke(...args);
        },
    }),
    async *tail(input) {
      const { tail } = await import("@the-vibe-company/openboard");
      yield* tail({ ...input, ...connection });
    },
  };
}
