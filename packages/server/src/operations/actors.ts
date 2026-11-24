import { BoardError, type getMe, type listActors, type OutputOf } from "@openboard/contract";
import { formatId } from "@openboard/core";
import { authorOf } from "../auth/author.ts";
import {
  callerCan,
  credentialExpiry,
  credentialKind,
  credentialName,
  memberOf,
  type Principal,
  type SessionMember,
} from "../deps.ts";
import type { Handler } from "./index.ts";

type Me = OutputOf<typeof getMe>;

const BOARD = { org: { slug: "local", name: "Local" }, board: { slug: "main", name: "main" } } as const;
/** A connection's secret or an agent token: the connection's name, profile, and effective permissions. */
function workflowMe(
  by: Principal,
  credential: "connection" | "agent" | "oidc",
  board: Pick<Me["openboard"], "org" | "board"> = BOARD,
): Me {
  const can = by[callerCan];
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
    expiresAt: by[credentialExpiry] ?? null,
    can,
    openboard: { ...board, role: null, credential },
  };
}

/** A signed-in person: as their sign-in shows them, with their role in the board's organization. */
function personMe(by: Principal, member: SessionMember, credential: "session" | "personal"): Me {
  const { actor, principal, profile } = by;
  const { kind, handle, name, avatar } = authorOf(by);
  const { role, org, board } = member;
  const can = by[callerCan] ?? {};
  const { [credentialExpiry]: expiresAt, [credentialName]: tokenName } = by;
  return {
    actor,
    principal,
    kind,
    handle,
    name,
    avatar,
    profile,
    expiresAt: expiresAt ?? null,
    ...(kind === "person"
      ? {
          credential: {
            kind: credential,
            ...(tokenName === undefined ? {} : { name: tokenName }),
            ...(expiresAt === undefined ? {} : { expiresAt }),
          },
        }
      : {}),
    can,
    openboard: { org, board, role, credential },
  };
}

export const getMeHandler: Handler<typeof getMe> = async (ctx) => {
  const { by } = ctx;
  const credential = by[credentialKind];
  if (credential === "connection" || credential === "agent") return workflowMe(by, credential);
  if (credential === "oidc") return workflowMe(by, credential, await ctx.board.identity());
  const member = by[memberOf];
  if ((credential === "session" || credential === "personal") && member) return personMe(by, member, credential);
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
