import { BoardError, type SignInProvider } from "@openboard/contract";
import type { PlatformView } from "@openboard/ports";
import type { Deps, ServerConfig } from "../../deps.ts";
import { base32, hashToken } from "../secrets.ts";
import { base64url, cookieOf, hostCookie, mintSession, sameText } from "../sessions.ts";
import { githubProvider } from "./github/index.ts";

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
const INVITATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
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

export interface SignInContext {
  readonly config: ServerConfig;
  readonly deps: Deps;
  readonly platform: PlatformView;
  readonly providers: readonly LoginProvider[];
}

async function start(
  provider: LoginProvider,
  ctx: SignInContext,
  redirectUri: string,
  invitation: string | null,
): Promise<Response> {
  const state = base64url(ctx.deps.randomBytes(32));
  const verifier = base64url(ctx.deps.randomBytes(32));
  const response = await provider.start({ state, verifier, redirectUri });
  const pending = `${provider.id}.${state}.${verifier}`;
  const value = invitation && INVITATION_TOKEN.test(invitation) ? `${pending}.${invitation}` : pending;
  response.headers.append("set-cookie", hostCookie(SIGN_IN_COOKIE, value, SIGN_IN_SECONDS));
  return response;
}

/** The provider's callback: checks `state`, has the provider prove who it is, then opens a session. */
async function callback(provider: LoginProvider, ctx: SignInContext, request: Request, redirectUri: string) {
  const [id, state = "", verifier = "", invitation = ""] = (cookieOf(request, SIGN_IN_COOKIE) ?? "").split(".");
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
  const invitationHash =
    signup === "invite" && INVITATION_TOKEN.test(invitation) ? Buffer.from(hashToken(invitation), "hex") : undefined;
  const person = await ctx.platform.signIn({
    identity: { provider: provider.id, subject, login, name, email: verified, avatar: avatar ?? null },
    admitNew: signup === "open",
    ...(invitationHash && { invitationHash }),
    newPersonId: `u_${base32(ctx.deps.randomBytes(10))}`,
    session: session.record,
    now,
  });
  if (!person) {
    throw new BoardError(
      "forbidden",
      signup === "invite" ? "sign-up requires an invitation" : "sign-up is unavailable",
      {
        hint: "Ask an administrator to invite you.",
      },
    );
  }
  const [membership] = await ctx.platform.memberships(person.id);
  const headers = new Headers({ location: membership ? `/${membership.org.slug}/main` : "/new" });
  headers.append("set-cookie", session.cookie);
  headers.append("set-cookie", hostCookie(SIGN_IN_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

/**
 * Browser sign-in at `/auth/<provider>/start` and `/auth/<provider>/callback` (docs/codebase.md 2.2, "browser sign-in
 * at /auth"): redirects, outside the `/api` contract. Null for any other path or method.
 */
export function signInRoute(request: Request, url: URL, ctx: SignInContext): Promise<Response> | null {
  const [, id, step] = ROUTE.exec(url.pathname) ?? [];
  const provider = ctx.providers.find((candidate) => candidate.id === id);
  if (request.method !== "GET" || !provider) return null;
  const redirectUri = `${ctx.config.publicUrl}/auth/${provider.id}/callback`;
  return step === "start"
    ? start(provider, ctx, redirectUri, url.searchParams.get("invitation"))
    : callback(provider, ctx, request, redirectUri);
}
