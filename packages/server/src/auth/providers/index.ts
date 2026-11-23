import { BoardError, type SignInProvider } from "@openboard/contract";
import type { PlatformView } from "@openboard/ports";
import type { Deps, ServerConfig } from "../../deps.ts";
import { base32 } from "../secrets.ts";
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
/** Where a person lands once signed in: creating their organization (docs/auth.md "Sign-up and sign-in"). */
const LANDING = "/new";
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

async function start(provider: LoginProvider, ctx: SignInContext, redirectUri: string): Promise<Response> {
  const state = base64url(ctx.deps.randomBytes(32));
  const verifier = base64url(ctx.deps.randomBytes(32));
  const response = await provider.start({ state, verifier, redirectUri });
  const pending = `${provider.id}.${state}.${verifier}`;
  response.headers.append("set-cookie", hostCookie(SIGN_IN_COOKIE, pending, SIGN_IN_SECONDS));
  return response;
}

/** The provider's callback: checks `state`, has the provider prove who it is, then opens a session. */
async function callback(provider: LoginProvider, ctx: SignInContext, request: Request, redirectUri: string) {
  const [id, state = "", verifier = ""] = (cookieOf(request, SIGN_IN_COOKIE) ?? "").split(".");
  if (id !== provider.id || !sameText(new URL(request.url).searchParams.get("state"), state)) {
    throw new BoardError("unauthorized", "this sign-in was not started in this browser, or took over 10 minutes", {
      hint: `Start again from /auth/${provider.id}/start.`,
    });
  }
  const identity = await provider.finish(request, { state, verifier, redirectUri });
  const now = ctx.deps.now();
  const session = mintSession(ctx.deps.randomBytes, now);
  const person = await ctx.platform.signIn({
    identity: {
      provider: provider.id,
      subject: identity.subject,
      login: identity.login,
      name: identity.name,
      email: identity.emailVerified ? (identity.email ?? null) : null,
      avatar: identity.avatar ?? null,
    },
    admitNew: (ctx.config.signup ?? "closed") === "open",
    newPersonId: `u_${base32(ctx.deps.randomBytes(10))}`,
    session: session.record,
    now,
  });
  if (!person) {
    throw new BoardError("forbidden", "sign-up is closed on this server", {
      hint: "Ask an administrator of this server for an invitation.",
    });
  }
  const headers = new Headers({ location: LANDING });
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
  return step === "start" ? start(provider, ctx, redirectUri) : callback(provider, ctx, request, redirectUri);
}
