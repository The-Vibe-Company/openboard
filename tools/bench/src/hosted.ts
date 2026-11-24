import { createConnection, createOrg, getSession } from "@openboard/contract";
import type { App, ServerConfig } from "@openboard/server";

/** The bench's organization; its first board is `main`. */
const ORG = "bench";

/** What hosted mode adds to the server config: open sign-up through a GitHub client whose provider is faked. */
export const hostedConfig = {
  signup: "open",
  signIn: { github: { clientId: "example-client", clientSecret: "example-client-secret" } },
} as const satisfies Partial<ServerConfig>;

/** Fakes only the provider's HTTP responses: the app still verifies OAuth state and issues a real session. */
export async function fakeGitHub(request: Request): Promise<Response> {
  const { origin, pathname } = new URL(request.url);
  if (origin === "https://github.com" && pathname === "/login/oauth/access_token") {
    return Response.json({ access_token: "example-access" });
  }
  if (origin === "https://api.github.com" && request.headers.get("authorization") === "Bearer example-access") {
    if (pathname === "/user") return Response.json({ id: 1, login: "bench", name: "Bench" });
    if (pathname === "/user/emails") {
      return Response.json([{ email: "bench@example.test", primary: true, verified: true }]);
    }
  }
  return new Response(null, { status: 404 });
}

function cookie(response: Response, name: string): string {
  const value = response.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${name}=`))
    ?.split(";")[0];
  if (!value) throw new Error(`bench sign-in did not return ${name} (HTTP ${response.status})`);
  return value;
}

/** `status` is the operation's catalogued success status. */
async function expectStatus(response: Response, status: unknown, what: string): Promise<Response> {
  if (response.status !== status) throw new Error(`${what} answered ${response.status}, not ${status}`);
  return response;
}

/**
 * Signs in through `app` with the faked provider, creates the bench's organization, and returns its board's URL with
 * the secret of a direct connection that may do everything there. The secret stays in this process's memory.
 */
export async function hostedBoard(app: App, origin: string): Promise<{ readonly url: string; readonly token: string }> {
  const call = (path: string, init?: RequestInit) => app.fetch(new Request(new URL(path, origin).href, init));
  const started = await call("/auth/github/start", { redirect: "manual" });
  const state = new URL(started.headers.get("location") ?? "", origin).searchParams.get("state");
  if (!state) throw new Error("bench sign-in did not return OAuth state");
  const query = new URLSearchParams({ code: "example-code", state });
  const returned = await call(`/auth/github/callback?${query}`, {
    headers: { cookie: cookie(started, "__Host-ob_signin") },
  });
  const session = cookie(returned, "__Host-ob_session");

  const read = await expectStatus(
    await call(`/api/x${getSession.route.path}`, { headers: { cookie: session } }),
    200,
    "reading the session",
  );
  const { csrf } = (await read.json()) as (typeof getSession.output)["static"];
  if (!csrf) throw new Error("bench sign-in did not establish a session with CSRF");
  const headers = { cookie: session, "x-ob-csrf": csrf, origin, "content-type": "application/json" };
  const org = { slug: ORG, name: "Bench" } satisfies (typeof createOrg.input.body)["static"];
  const created = await call(`/api/x${createOrg.route.path}`, {
    method: createOrg.route.method,
    headers,
    body: JSON.stringify(org),
  });
  await expectStatus(created, createOrg.status, "creating the bench organization");

  const url = `${origin}/api/${ORG}/main`;
  const connection = {
    name: "bench",
    direct: true,
    can: { "*": "all" },
  } satisfies (typeof createConnection.input.body)["static"];
  const response = await expectStatus(
    await app.fetch(
      new Request(url + createConnection.route.path, {
        method: createConnection.route.method,
        headers,
        body: JSON.stringify(connection),
      }),
    ),
    createConnection.status,
    "creating the bench connection",
  );
  const { secret } = (await response.json()) as (typeof createConnection.output)["static"];
  if (typeof secret !== "string" || !secret) throw new Error("the bench connection did not return a secret");
  return { url, token: secret };
}
