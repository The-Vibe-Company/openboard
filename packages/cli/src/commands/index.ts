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
  readonly wait: (ms: number) => Promise<void>;
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
  extends Omit<CommandContext, "client" | "boardUrl" | "now" | "wait" | "timeoutSignal" | "tail" | "interrupt"> {
  readonly env: CliEnvironment;
  readonly options: CliOptions;
}

export interface CommandMetadata {
  /** `["read"]`, `["tasks", "claim"]`. */
  readonly words: readonly string[];
  readonly usage: string;
  readonly help?: string;
}

export class Misuse extends Error {}

export interface Command {
  run(ctx: CommandContext): Promise<number>;
}

export interface StandaloneHandler {
  run(ctx: StandaloneContext): Promise<number>;
}

export interface RegisteredCommand extends CommandMetadata, Command {}
