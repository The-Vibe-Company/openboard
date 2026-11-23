import type { InputOf, Operation, OutputOf, operations, Scope } from "@openboard/contract";
import type { BoardView } from "@openboard/ports";
import type { Principal } from "../deps.ts";
import { discoverBoardHandler } from "./discovery.ts";
import { getMeHandler } from "./actors.ts";
import { listChannelsHandler } from "./channels.ts";
import { readEventsHandler } from "./events.ts";
import { listMessagesHandler, postMessageHandler } from "./messages.ts";
import { readThreadHandler } from "./threads.ts";

/** What a board operation's handler sees: the scoped board view, never the store (docs/codebase.md 4.4). */
export interface BoardContext {
  readonly board: BoardView;
  readonly by: Principal;
  readonly now: () => number;
}

/** What a `public` operation's handler sees: no store and no credential, only the board URL the request named. */
export interface PublicContext {
  /** `OPENBOARD_PUBLIC_URL` + `/api/<org>/<board>`, whether or not that board exists. */
  readonly boardUrl: string;
  readonly now: () => number;
}

/** The context an operation's handler takes; `never` for a union mixing public and tenant operations. */
type ContextOf<Op> = [Op] extends [{ readonly scope: "public" }]
  ? PublicContext
  : [Op] extends [{ readonly scope: Exclude<Scope, "public"> }]
    ? BoardContext
    : never;

export type Handler<Op extends Operation> = (ctx: ContextOf<Op>, input: InputOf<Op>) => Promise<OutputOf<Op>>;

type Contracted = (typeof operations)[number];
/** The operations answered without a tenant or a credential. */
export type PublicOperation = Extract<Contracted, { readonly scope: "public" }>;

/** One handler per contract operation: a missing or mistyped one is a compile error. */
export const handlers: { readonly [Op in Contracted as Op["name"]]: Handler<Op> } = {
  discoverBoard: discoverBoardHandler,
  getMe: getMeHandler,
  listChannels: listChannelsHandler,
  listMessages: listMessagesHandler,
  postMessage: postMessageHandler,
  readEvents: readEventsHandler,
  readThread: readThreadHandler,
};

/** The handler of an operation the router matched, its input already validated against the same contract. */
export function handlerOf<Op extends Contracted>(
  operation: Op,
): (ctx: ContextOf<Op>, input: unknown) => Promise<unknown> {
  return handlers[operation.name] as (ctx: ContextOf<Op>, input: unknown) => Promise<unknown>;
}
