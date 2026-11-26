import { BoardError, type SignInProvider } from "@openboard/contract";
import type { PlatformView } from "@openboard/ports";
import type { Deps, ServerConfig } from "../../deps.ts";
import type { RequestLimits } from "../../http/limits.ts";
import { base32, hashToken } from "../secrets.ts";
import { base64url, cookieOf, hostCookie, mintSession, sameText } from "../sessions.ts";
import { githubProvider } from "./github/index.ts";
import { signInWithInvitation } from "./invitation.ts";

/** Who a provider says signed in (docs/auth.md "Sign-in providers"); `subject` is its stable ID for them. */
export interface ExternalIdentity {
  readonly provider: string;
  readonly subject: string;
  readonly login: string;
  readonly name: string;
  readonly email?: string;
  readonly emailVerified: boolean;
  readonly avatar?: string;
}

/** One way to sign in (a seam): GitHub is built; Google and email links plug in here. */
export interface LoginProvider {
  readonly id: string;
  /** The redirect to the provider; `verifier` is the PKCE secret whose challenge it sends. */
  start(ctx: { state: string; verifier: string; redirectUri: string; loginHint?: string }): Promise<Response>;
  /** The identity the provider's callback proves; `state` was already checked against the browser's cookie. */
  finish(request: Request, ctx: { state: string; verifier: string; redirectUri: string }): Promise<ExternalIdentity>;
}

/** The pending sign-in: provider, `state` and PKCE verifier, kept in the browser for 10 minutes, not on a server. */
const SIGN_IN_COOKIE = "__Host-ob_signin";
const SIGN_IN_SECONDS = 600;
const MOBILE_CODE_MS = 120_000;
const INVITATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MOBILE_STATE = /^[A-Za-z0-9_-]{16,64}$/;
const ROUTE = /^\/auth\/([a-z][a-z0-9-]*)\/(start|callback)$/;

/** The providers this server offers: those configured with a client, when outbound HTTP is available. */
export function loginProviders(config: ServerConfig, deps: Deps): readonly LoginProvider[] {
  const github = config.signIn?.github;
  return github && deps.fetch ? [githubProvider(github, deps.fetch)] : [];
}

/** The providers as `GET /api/x/session` lists them. */
export function providerLinks(providers: readonly LoginProvider[], publicUrl: string): SignInProvider[] {
  return providers.map(({ id }) => ({ id, start: `${publicUrl}/auth/${id}/start` }));
}

export { githubOidc as oidcIssuer } from "./github/oidc.ts";

export interface SignInContext extends RequestLimits {
  readonly config: ServerConfig;
  readonly deps: Deps;
  readonly platform: PlatformView;
  readonly providers: readonly LoginProvider[];
}

async function start(
  provider: LoginProvider,
  ctx: SignInContext,
  redirectUri: string,
  extra: string | null,
): Promise<Response> {
  const state = base64url(ctx.deps.randomBytes(32));
  const verifier = base64url(ctx.deps.randomBytes(32));
  const response = await provider.start({ state, verifier, redirectUri });
  const pending = `${provider.id}.${state}.${verifier}`;
  const value = extra ? `${pending}.${extra}` : pending;
  response.headers.set("cache-control", "no-store");
  response.headers.append("set-cookie", hostCookie(SIGN_IN_COOKIE, value, SIGN_IN_SECONDS));
  return response;
}

async function mobileRedirect(
  ctx: SignInContext,
  personId: string,
  membershipSlug: string | undefined,
  clientState: string,
  now: number,
): Promise<string> {
  if (!membershipSlug) return `openboard://auth/callback?error=no_org&state=${clientState}`;
  const deviceCode = base64url(ctx.deps.randomBytes(32));
  const userCode = base32(ctx.deps.randomBytes(10))
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, "$1-");
  await ctx.platform.startDevice(hashToken(deviceCode), userCode, "OpenBoard iOS", now, now + MOBILE_CODE_MS);
  const approved = await ctx.platform.approveDevice(userCode, membershipSlug, personId, now);
  if (!approved) return `openboard://auth/callback?error=approval_failed&state=${clientState}`;
  return `openboard://auth/callback?code=${deviceCode}&state=${clientState}`;
}

/** The provider's callback: checks `state`, has the provider prove who it is, then opens a session. */
async function callback(provider: LoginProvider, ctx: SignInContext, request: Request, redirectUri: string) {
  const [id, state = "", verifier = "", extra = ""] = (cookieOf(request, SIGN_IN_COOKIE) ?? "").split(".");
  if (id !== provider.id || !sameText(new URL(request.url).searchParams.get("state"), state)) {
    throw new BoardError("unauthorized", "this sign-in was not started in this browser, or took over 10 minutes", {
      hint: `Start again from /auth/${provider.id}/start.`,
    });
  }
  const found = await provider.finish(request, { state, verifier, redirectUri });
  const { subject, login, name, email, emailVerified, avatar } = found;
  const now = ctx.deps.now();
  const session = mintSession(ctx.deps.randomBytes, now);
  const verified = emailVerified ? (email ?? null) : null;
  const signup = ctx.config.signup ?? "closed";
  const record = {
    identity: { provider: provider.id, subject, login, name, email: verified, avatar: avatar ?? null },
    admitNew: signup === "open",
    newPersonId: `u_${base32(ctx.deps.randomBytes(10))}`,
    session: session.record,
    now,
  };
  const { person, next } = INVITATION_TOKEN.test(extra)
    ? await signInWithInvitation(ctx.platform, signup, record, extra)
    : { person: await ctx.platform.signIn(record), next: undefined };
  if (!person) {
    throw new BoardError(
      "forbidden",
      signup === "invite" ? "sign-up requires an invitation" : "sign-up is unavailable",
      {
        hint: "Ask an administrator to invite you.",
      },
    );
  }
  const [membership] = next ? [] : await ctx.platform.memberships(person.id);
  const mobileState = extra.startsWith("ios:") ? extra.slice(4) : "";
  const location =
    mobileState && MOBILE_STATE.test(mobileState)
      ? await mobileRedirect(ctx, person.id, membership?.org.slug, mobileState, now)
      : (next ?? (membership ? `/${membership.org.slug}/main` : "/new"));
  const headers = new Headers({
    location,
    "cache-control": "no-store",
  });
  headers.append("set-cookie", session.cookie);
  headers.append("set-cookie", hostCookie(SIGN_IN_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

/**
 * Browser sign-in at `/auth/<provider>/start` and `/auth/<provider>/callback` (docs/codebase.md 2.2, "browser sign-in
 * at /auth"): redirects, outside the `/api` contract. Null for any other path or method.
 */
export async function signInRoute(request: Request, url: URL, ctx: SignInContext): Promise<Response | null> {
  const [, id, step] = ROUTE.exec(url.pathname) ?? [];
  const provider = ctx.providers.find((candidate) => candidate.id === id);
  if (request.method !== "GET" || !provider) return null;
  const seconds = await ctx.rateLimits.takeSignIn(ctx.ip);
  if (seconds !== undefined) {
    throw new BoardError("rate_limited", "too many browser sign-in attempts from this IP", {
      next: [{ kind: "wait", seconds }],
    });
  }
  const redirectUri = `${ctx.config.publicUrl}/auth/${provider.id}/callback`;
  if (step !== "start") return callback(provider, ctx, request, redirectUri);

  const invitation = url.searchParams.get("invitation");
  if (invitation) {
    // The browser only sends the invitation page URL as the referrer for a same-origin request.
    const page = URL.parse(request.headers.get("referer") ?? "");
    if (
      page?.origin !== new URL(ctx.config.publicUrl).origin ||
      page.pathname.replace(/\/$/, "") !== `/invite/${invitation}`
    ) {
      throw new BoardError("forbidden", "open the invitation page before starting sign-in");
    }
    return start(provider, ctx, redirectUri, INVITATION_TOKEN.test(invitation) ? invitation : null);
  }
  const mobile = url.searchParams.get("app") === "ios" ? url.searchParams.get("client_state") : null;
  const extra = mobile && MOBILE_STATE.test(mobile) ? `ios:${mobile}` : null;
  return start(provider, ctx, redirectUri, extra);
}
