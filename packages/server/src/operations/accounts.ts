import {
  type approveDeviceSignIn,
  BoardError,
  type getAccount,
  type getSession,
  type listPersonalTokens,
  parseCanScope,
  type pollDeviceSignIn,
  type previewDeviceSignIn,
  type revokeAllSessions,
  type revokePersonalToken,
  type startDeviceSignIn,
} from "@openboard/contract";
import { grants } from "@openboard/core";
import { base32, hashToken, mintSecret, SECRET_BYTES } from "../auth/secrets.ts";
import { base64url } from "../auth/sessions.ts";
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

export const revokeAllSessionsHandler: Handler<typeof revokeAllSessions> = async (ctx) => {
  const { id } = signedIn(ctx);
  await ctx.platform.revokeAllSessions(id, ctx.now());
  return { ok: true };
};

export const listPersonalTokensHandler: Handler<typeof listPersonalTokens> = async (ctx) => {
  const id = ctx.tokenPersonId ?? signedIn(ctx).id;
  return { tokens: await ctx.platform.listPersonalTokens(id) };
};

export const revokePersonalTokenHandler: Handler<typeof revokePersonalToken> = async (ctx, { id }) => {
  const personId = ctx.tokenPersonId ?? signedIn(ctx).id;
  const revokedAt = await ctx.platform.revokePersonalToken(personId, id, ctx.now());
  if (revokedAt === null) throw new BoardError("not_found", "no such personal token");
  return { id, revokedAt };
};

const DEVICE_LIFETIME = 600;
const POLL_INTERVAL = 5;
const TOKEN_LIFETIME = 30 * 86_400_000;

export const startDeviceSignInHandler: Handler<typeof startDeviceSignIn> = async (ctx, { clientName, can }) => {
  const scope = can === undefined ? undefined : grants.compileCan(parseCanScope(can));
  // Older servers reject the longer code instead of exchanging it for an unrestricted token.
  const deviceCode = base64url(ctx.randomBytes(32)) + (scope === undefined ? "" : "n");
  const userCode = base32(ctx.randomBytes(10))
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, "$1-");
  const now = ctx.now();
  await ctx.platform.startDevice(hashToken(deviceCode), userCode, clientName, now, now + DEVICE_LIFETIME * 1000, scope);
  return {
    deviceCode,
    userCode,
    verificationUri: `${ctx.publicUrl}/device`,
    interval: POLL_INTERVAL,
    expiresIn: DEVICE_LIFETIME,
  };
};

export const previewDeviceSignInHandler: Handler<typeof previewDeviceSignIn> = async (ctx, { userCode }) => {
  signedIn(ctx);
  const preview = await ctx.platform.previewDevice(userCode, ctx.now());
  if (!preview) throw new BoardError("not_found", "no available device approval");
  return preview;
};

export const approveDeviceSignInHandler: Handler<typeof approveDeviceSignIn> = async (ctx, { userCode, org }) => {
  const { id } = signedIn(ctx);
  if (!(await ctx.platform.approveDevice(userCode, org, id, ctx.now()))) {
    throw new BoardError("not_found", "no available device approval for this organization");
  }
  return { ok: true };
};

export const pollDeviceSignInHandler: Handler<typeof pollDeviceSignIn> = async (ctx, { deviceCode }) => {
  const now = ctx.now();
  const secret = mintSecret("obp_", ctx.randomBytes(SECRET_BYTES));
  const result = await ctx.platform.pollDevice(hashToken(deviceCode), POLL_INTERVAL * 1000, {
    id: `pt_${secret.name}`,
    tokenHash: secret.hash,
    now,
    expiresAt: now + TOKEN_LIFETIME,
  });
  if (result.status === "pending") return { pending: true };
  if (result.status === "too_soon") throw new BoardError("rate_limited", "device code polled too soon");
  if (result.status !== "issued") throw new BoardError("not_found", "the device code expired or was used");
  const { org, boards } = result;
  return {
    token: secret.token,
    org,
    boards: boards.map((board) => ({ ...board, url: `${ctx.publicUrl}/api/${org.slug}/${board.slug}` })),
  };
};
