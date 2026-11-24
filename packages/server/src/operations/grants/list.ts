import { BoardError, type listGrants } from "@openboard/contract";
import { agents } from "@openboard/core";
import { allowedEverywhere, isNarrowedPersonal } from "../../auth/access.ts";
import { callerCan, credentialKind, memberOf, type Principal } from "../../deps.ts";
import type { Handler } from "../index.ts";

/** Upstream allows a board owner or a caller with manage at the wildcard to list grants. */
export function canListGrants(by: Principal): boolean {
  if (isNarrowedPersonal(by)) return allowedEverywhere(by[callerCan] ?? {}, "manage");
  return (
    by[credentialKind] === "local" ||
    by[memberOf]?.role === "owner" ||
    agents.allowedAt(by[callerCan] ?? {}, "*").includes("manage")
  );
}

export const listGrantsHandler: Handler<typeof listGrants> = async (ctx) => {
  if (!canListGrants(ctx.by)) throw new BoardError("forbidden", "listing grants needs manage at *");
  return { grants: await ctx.board.listGrants() };
};
