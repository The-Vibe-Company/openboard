import { createHash } from "node:crypto";
import { BoardError } from "@openboard/contract";
import type { OAuthClient } from "../../../deps.ts";
import type { ExternalIdentity, LoginProvider } from "../index.ts";

const AUTHORIZE = "https://github.com/login/oauth/authorize";
const TOKEN = "https://github.com/login/oauth/access_token";
const API = "https://api.github.com";
const AGENT = "openboard";
/** Enough to read the person and their verified primary email (docs/auth.md "Sign-in providers"). */
const SCOPES = "read:user user:email";

type Fetch = (request: Request) => Promise<Response>;

type GitHubUser = { id: number; login: string; name: string | null; avatar_url: string | null };
type GitHubEmail = { email: string; primary: boolean; verified: boolean };

const remoteError = (message: string) =>
  new BoardError("remote_error", `GitHub ${message}`, { hint: "Try signing in again in a moment." });

/** GitHub's JSON answer, or `remote_error`; a network failure is `unreachable`. */
async function call(fetch: Fetch, request: Request): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(request);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new BoardError("unreachable", "GitHub could not be reached", { hint: "Try signing in again in a moment." });
  }
  if (!response.ok) throw remoteError(`answered ${response.status}`);
  // Not JSON is answered as null, which every caller then refuses as `remote_error`.
  return response.json().catch((error) => (error instanceof SyntaxError ? null : Promise.reject(error)));
}

function isUser(value: unknown): value is GitHubUser {
  const user = value as Partial<GitHubUser> | null;
  return typeof user?.id === "number" && typeof user.login === "string";
}

function isEmails(value: unknown): value is GitHubEmail[] {
  return Array.isArray(value) && value.every((entry) => typeof entry?.email === "string");
}

/** Trades the callback's code, with the PKCE verifier, for a GitHub token used for the next two reads only. */
async function exchange(fetch: Fetch, client: OAuthClient, code: string, verifier: string, redirectUri: string) {
  const body = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const headers = { accept: "application/json", "content-type": "application/x-www-form-urlencoded" };
  const answer = await call(fetch, new Request(TOKEN, { method: "POST", headers, body }));
  const token = (answer as { access_token?: unknown } | null)?.access_token;
  if (typeof token !== "string" || token === "") throw remoteError("refused the sign-in code");
  return token;
}

/**
 * GitHub OAuth with PKCE and `state` (docs/auth.md "Sign-in providers"). The GitHub token reads the user and their
 * verified primary email, then is dropped: it is never stored or logged.
 */
export function githubProvider(client: OAuthClient, fetch: Fetch): LoginProvider {
  return {
    id: "github",
    async start({ state, verifier, redirectUri }) {
      const url = new URL(AUTHORIZE);
      url.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        scope: SCOPES,
        state,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      }).toString();
      return new Response(null, { status: 302, headers: { location: url.href } });
    },
    async finish(request, { verifier, redirectUri }): Promise<ExternalIdentity> {
      const code = new URL(request.url).searchParams.get("code");
      if (!code) {
        throw new BoardError("unauthorized", "GitHub did not sign you in", {
          hint: "Start again from /auth/github/start.",
        });
      }
      const token = await exchange(fetch, client, code, verifier, redirectUri);
      const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": AGENT };
      const [user, emails] = await Promise.all([
        call(fetch, new Request(`${API}/user`, { headers })),
        call(fetch, new Request(`${API}/user/emails`, { headers })),
      ]);
      if (!isUser(user) || !isEmails(emails)) throw remoteError("answered an unexpected user");
      const primary = emails.find((entry) => entry.primary && entry.verified);
      return {
        provider: "github",
        subject: String(user.id),
        login: user.login,
        name: user.name || user.login,
        ...(primary && { email: primary.email }),
        emailVerified: primary !== undefined,
        ...(user.avatar_url && { avatar: user.avatar_url }),
      };
    },
  };
}
