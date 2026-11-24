import { basename } from "node:path";
import process from "node:process";
import { runCli } from "@the-vibe-company/openboard-cli";
import { type Config, ConfigError, clientEnvironment, loadConfig } from "./config.ts";
import { migrate } from "./migrate.ts";
import { serve } from "./serve.ts";

const output = {
  out: (line: string) => process.stdout.write(`${line}\n`),
  err: (line: string) => process.stderr.write(`${line}\n`),
};

/** The server commands (D42); each returns its exit code. */
const serverCommands: Readonly<Record<string, (config: Config) => Promise<number>>> = {
  serve: async (config) => {
    await serve(config);
    return 0;
  },
  migrate: (config) => migrate(config, output),
};

/** The `openboard` / `ob` executable: server commands here, every other command to the client CLI. */
async function main(argv: readonly string[]): Promise<void> {
  const name = argv[0];
  if (
    (name === undefined || (name === "--help" && argv.length === 1)) &&
    /^openboard(?:-bun-.+)?$/.test(basename(process.execPath))
  ) {
    output.out("Usage: openboard <serve | migrate>");
    output.out("For board client commands, run ob.");
    return;
  }
  const command = name !== undefined && Object.hasOwn(serverCommands, name) ? serverCommands[name] : undefined;
  if (!command) {
    process.exitCode = await runCli(argv, clientEnvironment());
    return;
  }
  try {
    process.exitCode = await command(loadConfig());
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

await main(process.argv.slice(2));
