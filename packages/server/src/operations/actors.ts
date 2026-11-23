import { BoardError, type getMe, type OutputOf } from "@openboard/contract";
import { authorOf } from "../auth/author.ts";
import { credentialKind, type Principal } from "../deps.ts";
import type { BoardContext, Handler } from "./index.ts";

type Me = OutputOf<typeof getMe>;

const BOARD = { org: { slug: "local", name: "Local" }, board: { slug: "main", name: "main" } } as const;
const CONNECTION = "ob:conn:";

/** A connection's secret: the connection's name, and the permissions its grant gives (docs/auth.md "Connections"). */
async function connectionMe(board: BoardContext["board"], by: Principal): Promise<Me> {
  const record = await board.connection(by.principal.slice(CONNECTION.length));
  if (!record) throw new BoardError("unauthorized", "the credential is not valid on this board");
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
    can: record.connection.can,
    openboard: { ...BOARD, role: null, credential: "connection" },
  };
}

export const getMeHandler: Handler<typeof getMe> = async ({ board, by }) => {
  const credential = by[credentialKind];
  if (credential === "connection") return connectionMe(board, by);
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
