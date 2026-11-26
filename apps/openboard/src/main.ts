import { basename } from "node:path";
import process from "node:process";
import { runCli } from "@the-vibe-company/openboard-cli";
import { admin } from "./admin.ts";
import { type Config, ConfigError, clientEnvironment, loadConfig } from "./config.ts";
import { importOrganization } from "./import.ts";
import { migrate } from "./migrate.ts";
import { reproject } from "./reproject.ts";
import { restore } from "./restore.ts";
import { serve } from "./serve.ts";

const output = {
  out: (line: string) => process.stdout.write(`${line}\n`),
  err: (line: string) => process.stderr.write(`${line}\n`),
};

/** The server commands (D42); each returns its exit code. */
const serverCommands: Readonly<Record<string, (config: Config, args: readonly string[]) => Promise<number>>> = {
  serve: async (config) => {
    await serve(config);
    return 0;
  },
  admin: (config, args) => admin(config, args, output),
  migrate: (config) => migrate(config, output),
  reproject: (config, args) => reproject(config, args, output),
  restore: (config, args) => restore(config, args, output),
  import: (_config, args) => importOrganization(args, output),
};

/** The `openboard` / `ob` executable: server commands here, every other command to the client CLI. */
async function main(argv: readonly string[]): Promise<void> {
  const name = argv[0];
  if (
    (name === undefined || ((name === "--help" || name === "-h") && argv.length === 1)) &&
    /^openboard(?:-bun-.+)?$/.test(basename(process.execPath))
  ) {
    output.out("Usage: openboard <serve | migrate | admin | restore | import | reproject>");
    output.out("For board client commands, run ob help. Use openboard --version to print the version.");
    return;
  }
  const command = name !== undefined && Object.hasOwn(serverCommands, name) ? serverCommands[name] : undefined;
  if (!command) {
    process.exitCode = await runCli(argv, clientEnvironment());
    return;
  }
  try {
    process.exitCode = await command(loadConfig(), argv.slice(1));
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

await main(process.argv.slice(2));
