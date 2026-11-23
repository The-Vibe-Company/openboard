import type { InputOf, Operation, OutputOf, operations, SignInProvider } from "@openboard/contract";
import type { BoardView, PlatformView } from "@openboard/ports";
import type { Session } from "../auth/sessions.ts";
import type { Principal } from "../deps.ts";
import { getAccountHandler, getSessionHandler } from "./accounts.ts";
import { getMeHandler, listActorsHandler } from "./actors.ts";
import { createChannelHandler, listChannelsHandler } from "./channels.ts";
import { claimConnectionHandler, createConnectionHandler, refreshAgentTokenHandler } from "./connections.ts";
import { discoverBoardHandler, getOpenApiHandler } from "./discovery.ts";
import { readEventsHandler } from "./events.ts";
import { editMessageHandler, listMessagesHandler, postMessageHandler, readPostHandler } from "./messages.ts";
import { createOrgHandler } from "./orgs.ts";
import { listThreadsHandler, readThreadHandler } from "./threads.ts";

/** What a board operation's handler sees: the scoped board view, never the store (docs/codebase.md 4.4). */
export interface BoardContext {
  readonly board: BoardView;
  readonly by: Principal;
  readonly now: () => number;
  /** The canonical `BOARD_URL` of the board: `OPENBOARD_PUBLIC_URL` + `/api/<org>/<board>`. */
  readonly boardUrl: string;
  readonly randomBytes: (length: number) => Uint8Array;
}

/** What a `public` operation's handler sees: no store and no credential, only the board URL the request named. */
export interface PublicContext {
  /** `OPENBOARD_PUBLIC_URL` + `/api/<org>/<board>`, whether or not that board exists. */
  readonly boardUrl: string;
  readonly now: () => number;
}

/** What an `account` operation's handler sees: the platform view and the browser's session, if one is live. */
export interface AccountContext {
  readonly platform: PlatformView;
  readonly session: Session | null;
  readonly now: () => number;
  readonly mode: "local" | "hosted";
  /** The sign-in providers this server offers. */
  readonly providers: readonly SignInProvider[];
}

/** The context an operation's handler takes; `never` for a union mixing scopes that take different contexts. */
type ContextOf<Op> = [Op] extends [{ readonly scope: "public" }]
  ? PublicContext
  : [Op] extends [{ readonly scope: "account" }]
    ? AccountContext
    : [Op] extends [{ readonly scope: "org" | "board" }]
      ? BoardContext
      : never;

export type Handler<Op extends Operation> = (ctx: ContextOf<Op>, input: InputOf<Op>) => Promise<OutputOf<Op>>;

type Contracted = (typeof operations)[number];
/** The operations answered without a tenant or a credential. */
export type PublicOperation = Extract<Contracted, { readonly scope: "public" }>;
/** The operations of the signed-in person, under `/api/x`. */
export type AccountOperation = Extract<Contracted, { readonly scope: "account" }>;

/** One handler per contract operation: a missing or mistyped one is a compile error. */
export const handlers: { readonly [Op in Contracted as Op["name"]]: Handler<Op> } = {
  claimConnection: claimConnectionHandler,
  createChannel: createChannelHandler,
  createConnection: createConnectionHandler,
  createOrg: createOrgHandler,
  discoverBoard: discoverBoardHandler,
  editMessage: editMessageHandler,
  getAccount: getAccountHandler,
  getMe: getMeHandler,
  getOpenApi: getOpenApiHandler,
  getSession: getSessionHandler,
  listActors: listActorsHandler,
  listChannels: listChannelsHandler,
  listMessages: listMessagesHandler,
  listThreads: listThreadsHandler,
  postMessage: postMessageHandler,
  readEvents: readEventsHandler,
  readPost: readPostHandler,
  readThread: readThreadHandler,
  refreshAgentToken: refreshAgentTokenHandler,
};

/** The handler of an operation the router matched, its input already validated against the same contract. */
export function handlerOf<Op extends Contracted>(
  operation: Op,
): (ctx: ContextOf<Op>, input: unknown) => Promise<unknown> {
  return handlers[operation.name] as (ctx: ContextOf<Op>, input: unknown) => Promise<unknown>;
}
