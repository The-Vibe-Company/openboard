import type { InputOf, Operation, OutputOf, operations } from "@openboard/contract";
import type { BoardView } from "@openboard/ports";
import type { Principal } from "../deps.ts";
import { listMessagesHandler, postMessageHandler } from "./messages.ts";
import { readThreadHandler } from "./threads.ts";

/** What a board operation's handler sees: the scoped board view, never the store (docs/codebase.md 4.4). */
export interface BoardContext {
  readonly board: BoardView;
  readonly by: Principal;
  readonly now: () => number;
}

export type Handler<Op extends Operation> = (ctx: BoardContext, input: InputOf<Op>) => Promise<OutputOf<Op>>;

type Contracted = (typeof operations)[number];

/** One handler per contract operation: a missing or mistyped one is a compile error. */
export const handlers: { readonly [Op in Contracted as Op["name"]]: Handler<Op> } = {
  listMessages: listMessagesHandler,
  postMessage: postMessageHandler,
  readThread: readThreadHandler,
};

/** The handler of an operation the router matched, its input already validated against the same contract. */
export function handlerOf(operation: Contracted): (ctx: BoardContext, input: unknown) => Promise<unknown> {
  return handlers[operation.name] as (ctx: BoardContext, input: unknown) => Promise<unknown>;
}
