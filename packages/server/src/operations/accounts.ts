import type { getAccount, getSession } from "@openboard/contract";
import type { Handler } from "./index.ts";
import { signedIn } from "./orgs.ts";

/** Signed in or not, with the person, their CSRF value and the providers to sign in with (docs/protocol.md). */
export const getSessionHandler: Handler<typeof getSession> = async (ctx) => {
  const { session } = ctx;
  if (!session) return { signedIn: false, person: null, csrf: null, providers: [...ctx.providers] };
  const { id, providers, ...details } = session.person;
  return {
    signedIn: true,
    person: { principal: `ob:user:${id}`, ...details, providers: [...providers] },
    csrf: session.csrf,
    providers: [...ctx.providers],
  };
};

/** The signed-in person and their memberships, with their role in each (docs/protocol.md). */
export const getAccountHandler: Handler<typeof getAccount> = async (ctx) => {
  const { id, providers, ...details } = signedIn(ctx);
  const memberships = await ctx.platform.memberships(id);
  return { person: { principal: `ob:user:${id}`, ...details, providers: [...providers] }, memberships };
};
