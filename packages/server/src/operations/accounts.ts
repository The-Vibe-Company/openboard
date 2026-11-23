import type { getSession } from "@openboard/contract";
import type { Handler } from "./index.ts";

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
