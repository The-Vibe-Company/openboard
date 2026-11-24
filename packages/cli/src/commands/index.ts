import type { BoardEvent, Client, TailOptions } from "@the-vibe-company/openboard";
import type { CliEnvironment } from "../config.ts";
import type { CliOptions } from "../main.ts";
import type { Output } from "../output.ts";

/** What a command runs with: the client of the board at `BOARD_URL`, its arguments, and where to print. */
export interface CommandContext {
  readonly client: Client;
  readonly home?: string;
  readonly boardUrl: string;
  readonly now: () => number;
  readonly timeoutSignal: (ms: number) => AbortSignal;
  /** The SDK's live tail of the board at `BOARD_URL`, with the client's credentials. */
  readonly tail: (
    input: Omit<TailOptions, "url" | "token" | "csrf" | "profile" | "fetch">,
  ) => AsyncIterable<BoardEvent>;
  /** A signal aborted when the person presses Ctrl-C, and `release` to stop listening; only a command that runs until interrupted asks for it. */
  readonly interrupt: () => { readonly signal: AbortSignal; release(): void };
  readonly args: readonly string[];
  /** The explicit `--as` override. */
  readonly profile: string | undefined;
  /** How many of `args` came before `--`: only those may be `--name value` options. */
  readonly optionsEnd: number;
  readonly json: boolean;
  readonly output: Output;
}

export interface StandaloneContext
  extends Omit<CommandContext, "client" | "boardUrl" | "now" | "timeoutSignal" | "tail" | "interrupt"> {
  readonly env: CliEnvironment;
  readonly options: CliOptions;
}

export interface Command {
  /** `["read"]`, `["tasks", "claim"]`. */
  readonly words: readonly string[];
  readonly usage: string;
  run(ctx: CommandContext): Promise<number>;
}

export class Misuse extends Error {}

export { connectCommand } from "./connect.ts";
export { createConnectionCommand } from "./connections.ts";
export { derivedCommands } from "./derived.ts";
export { explainGrantsCommand } from "./grants/explain.ts";
export { createGrantCommand, updateGrantCommand } from "./grants.ts";
export { createInboundCommand } from "./inbound/index.ts";
export { loginCommand } from "./login.ts";
export { messagesCommand } from "./messages.ts";
export { downloadOrgExportCommand, exportOrgCommand } from "./org/export.ts";
export { readCommand } from "./read.ts";
export { replyCommand } from "./reply.ts";
export { rotateConnectionCommand } from "./rotate.ts";
export { createSchemaCommand } from "./schemas/create.ts";
export { tailCommand } from "./tail.ts";
export { useCommand } from "./use.ts";
export { waitCommand } from "./wait.ts";
export { createWebhookCommand } from "./webhooks/create.ts";
export { whoamiCommand } from "./whoami.ts";
