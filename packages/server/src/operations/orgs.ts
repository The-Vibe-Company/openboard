import { BoardError, type createOrg } from "@openboard/contract";
import { orgs } from "@openboard/core";
import type { AccountContext, Handler } from "./index.ts";

/** The signed-in person of an account operation, or 401 `unauthorized`. */
export function signedIn(ctx: AccountContext) {
  if (ctx.session) return ctx.session.person;
  throw new BoardError("unauthorized", "sign in first", {
    hint: "Sign in in the browser, then send its session cookie.",
  });
}

/** The organization, its owner membership, its board `main` and their events, in one transaction (docs/auth.md). */
export const createOrgHandler: Handler<typeof createOrg> = async (ctx, input) => {
  const person = signedIn(ctx);
  const principal = `ob:user:${person.id}`;
  const now = ctx.now();
  const creation = orgs.decideCreate(input, { by: principal, now });
  await ctx.platform.createOrg({ ...creation, personId: person.id, now });
  return { org: creation.org, membership: { principal, role: creation.role }, board: creation.board };
};
