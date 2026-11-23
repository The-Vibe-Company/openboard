import process from "node:process";
import { runCli } from "@the-vibe-company/openboard-cli";
import { ConfigError, clientEnvironment, loadConfig } from "./config.ts";
import { serve } from "./serve.ts";

/** The `openboard` / `ob` executable: server commands here, every other command to the client CLI. */
async function main(argv: readonly string[]): Promise<void> {
  if (argv[0] !== "serve") {
    process.exitCode = await runCli(argv, clientEnvironment());
    return;
  }
  try {
    await serve(loadConfig());
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

await main(process.argv.slice(2));
