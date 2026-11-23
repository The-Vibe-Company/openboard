import { BoardError, type getMe, type listActors, type OutputOf } from "@openboard/contract";
import { formatId } from "@openboard/core";
import { authorOf } from "../auth/author.ts";
import { agentOf, credentialKind, type Principal } from "../deps.ts";
import type { BoardContext, Handler } from "./index.ts";

type Me = OutputOf<typeof getMe>;

const BOARD = { org: { slug: "local", name: "Local" }, board: { slug: "main", name: "main" } } as const;
const CONNECTION = "ob:conn:";

/** What a connection's grant gives its secret, or an agent token claimed from it (docs/auth.md "Connections"). */
async function canOf(board: BoardContext["board"], by: Principal, credential: "connection" | "agent") {
  if (credential === "agent") return (await board.agent(by[agentOf] ?? ""))?.agent.can;
  return (await board.connection(by.principal.slice(CONNECTION.length)))?.connection.can;
}

/** A connection's secret or an agent token: the connection's name, the profile, and what the credential may do. */
async function connectionMe(
  board: BoardContext["board"],
  by: Principal,
  credential: "connection" | "agent",
): Promise<Me> {
  const can = await canOf(board, by, credential);
  if (!can) throw new BoardError("unauthorized", "the credential is not valid on this board");
  const { actor, principal, profile } = by;
  const { kind, handle, name, avatar } = authorOf(by);
  return {
    actor,
    principal,
    kind,
    handle,
    name,
    avatar,
    profile,
    expiresAt: null,
    can,
    openboard: { ...BOARD, role: null, credential },
  };
}

export const getMeHandler: Handler<typeof getMe> = async ({ board, by }) => {
  const credential = by[credentialKind];
  if (credential === "connection" || credential === "agent") return connectionMe(board, by, credential);
  if (!credential) throw new BoardError("unauthorized", "a local owner credential is required");
  const { actor, principal, profile } = by;
  const { kind, handle, name, avatar } = authorOf(by);
  return {
    actor,
    principal,
    kind,
    handle,
    name,
    avatar,
    profile,
    expiresAt: null,
    can: { "*": ["read", "post", "react", "label", "sync", "manage"] },
    openboard: { ...BOARD, role: "owner", credential },
  };
};

/** Every actor the board has seen write, by handle; the cursor is the board head the list was read at. */
export const listActorsHandler: Handler<typeof listActors> = async (ctx) => {
  const { actors, head } = await ctx.board.listActors();
  return { actors, cursor: formatId(head) };
};
