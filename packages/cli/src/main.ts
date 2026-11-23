import { BoardError, createClient } from "@the-vibe-company/openboard";
import { type Command, derivedCommands, Misuse, readCommand } from "./commands/index.ts";
import { clientConfig } from "./config.ts";
import { consoleOutput, type Output, printError } from "./output.ts";

export interface CliOptions {
  readonly output?: Output;
  readonly fetch?: (request: Request) => Promise<Response>;
}

const commands: readonly Command[] = [readCommand, ...derivedCommands];

function find(words: readonly string[]): Command | undefined {
  return commands
    .filter((command) => command.words.every((word, at) => words[at] === word))
    .sort((a, b) => b.words.length - a.words.length)[0];
}

function usage(output: Output, problem: string): number {
  output.err(problem);
  for (const command of commands) output.err(`  ${command.usage}`);
  return 2;
}

/** `ob`'s client commands. Exit codes: 0 success, 1 error, 2 misuse (docs/codebase.md 5.3). */
export async function runCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  options: CliOptions = {},
): Promise<number> {
  const output = options.output ?? consoleOutput;
  const json = argv.includes("--json");
  const words = argv.filter((arg) => arg !== "--json");
  const command = find(words);
  if (!command) return usage(output, words.length === 0 ? "usage:" : `unknown command: ${words.join(" ")}`);
  const config = clientConfig(env);
  if (!config.boardUrl) return usage(output, "BOARD_URL is not set: point it at a board, as `ob serve` prints it");
  const client = createClient({
    url: config.boardUrl,
    ...(config.token === undefined ? {} : { token: config.token }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  try {
    return await command.run({ client, args: words.slice(command.words.length), json, output });
  } catch (error) {
    if (error instanceof Misuse) return usage(output, `${error.message}: ${command.usage}`);
    if (!(error instanceof BoardError)) throw error;
    printError(output, error);
    return 1;
  }
}
