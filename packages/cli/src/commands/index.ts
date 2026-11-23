import type { Client } from "@the-vibe-company/openboard";
import type { Output } from "../output.ts";

/** What a command runs with: the client of the board at `BOARD_URL`, its arguments, and where to print. */
export interface CommandContext {
  readonly client: Client;
  readonly boardUrl: string;
  readonly args: readonly string[];
  /** How many of `args` came before `--`: only those may be `--name value` options. */
  readonly optionsEnd: number;
  readonly json: boolean;
  readonly output: Output;
}

export interface Command {
  /** `["read"]`, `["tasks", "claim"]`. */
  readonly words: readonly string[];
  readonly usage: string;
  run(ctx: CommandContext): Promise<number>;
}

export class Misuse extends Error {}

export { derivedCommands } from "./derived.ts";
export { readCommand } from "./read.ts";
export { replyCommand } from "./reply.ts";
export { whoamiCommand } from "./whoami.ts";
