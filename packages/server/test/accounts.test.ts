import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { BoardError, type ErrorBody, type SessionState } from "@openboard/contract";
import type { Store } from "@openboard/ports";
import { sessionOf } from "../src/auth/sessions.ts";
import { type App, createApp, type ServerConfig } from "../src/index.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL } from "./support/app.ts";
import { openStore } from "./support/drivers.ts";

const DAY = 86_400_000;
const CLIENT = { clientId: "example-client", clientSecret: "example-client-secret" };

let app: App | undefined;
let store: Store | undefined;
afterEach(async () => {
  await app?.close();
  await store?.close();
  app = store = undefined;
});

/** GitHub as the provider sees it: one user, and the token form it was sent, which must carry the PKCE verifier. */
function fakeGitHub() {
  const forms: URLSearchParams[] = [];
  const fetch = async (request: Request): Promise<Response> => {
    const { origin, pathname } = new URL(request.url);
    if (`${origin}${pathname}` === "https://github.com/login/oauth/access_token") {
      forms.push(new URLSearchParams(await request.text()));
      return Response.json({ access_token: "example-access" });
    }
    if (request.headers.get("authorization") !== "Bearer example-access") return new Response(null, { status: 401 });
    if (pathname === "/user") {
      return Response.json({ id: 583231, login: "ada", name: "Ada Lovelace", avatar_url: "https://avatars.test/ada" });
    }
    return Response.json([{ email: "ada@example.test", primary: true, verified: true }]);
  };
  return { fetch, forms };
}

function start(options: { signup?: "open" | "closed"; clock?: { now: number }; github?: false } = {}) {
  const github = fakeGitHub();
  const clock = options.clock ?? { now: NOW };
  const signIn: ServerConfig["signIn"] = options.github === false ? {} : { github: CLIENT };
  const config: ServerConfig = {
    mode: "local",
    publicUrl: PUBLIC_URL,
    localOwner: LOCAL_OWNER,
    signup: options.signup ?? "open",
    signIn,
  };
  let drawn = 0;
  const randomBytes = (length: number) => new Uint8Array(length).fill(++drawn);
  const deps = { now: () => clock.now, requestId: () => "req-1", randomBytes, log: { info() {}, error() {} } };
  app = createApp(config, { store: openStore(() => clock.now) }, { ...deps, fetch: github.fetch });
  return { app, github };
}

const get = (target: App, path: string, cookie?: string) =>
  target.fetch(new Request(`${PUBLIC_URL}${path}`, { headers: cookie ? { cookie } : {} }));

const sessionAt = async (target: App, cookie?: string) =>
  (await (await get(target, "/api/x/session", cookie)).json()) as SessionState;
const errorCode = async (response: Response) => ((await response.json()) as { error: ErrorBody }).error.code;

/** The `name=value` pairs of a response's `set-cookie` headers, by name. */
function cookiesOf(response: Response): Record<string, string> {
  const pairs = response.headers.getSetCookie().map((line) => line.split(";")[0]?.split("=") ?? []);
  return Object.fromEntries(pairs.map(([name = "", ...value]) => [name, value.join("=")]));
}

/** Runs the browser's round trip: start, GitHub's redirect back with a code, and the callback. */
async function signIn(target: App) {
  const started = await get(target, "/auth/github/start");
  const location = new URL(started.headers.get("location") ?? "");
  const pending = `__Host-ob_signin=${cookiesOf(started)["__Host-ob_signin"]}`;
  const state = location.searchParams.get("state") ?? "";
  const back = await get(target, `/auth/github/callback?code=example-code&state=${state}`, pending);
  return { started, location, back, session: `__Host-ob_session=${cookiesOf(back)["__Host-ob_session"]}` };
}

test("anyone reads the session: signed out, with the providers to sign in with, never cached", async () => {
  const { app } = start();
  const response = await get(app, "/api/x/session");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    signedIn: false,
    person: null,
    csrf: null,
    providers: [{ id: "github", start: `${PUBLIC_URL}/auth/github/start` }],
  });
});

test("signing in with GitHub, with PKCE and state, comes back with a session cookie the session reads", async () => {
  const { app, github } = start();
  const { started, location, back, session } = await signIn(app);
  expect(started.status).toBe(302);
  expect(`${location.origin}${location.pathname}`).toBe("https://github.com/login/oauth/authorize");
  expect(Object.fromEntries(location.searchParams)).toMatchObject({
    client_id: "example-client",
    redirect_uri: `${PUBLIC_URL}/auth/github/callback`,
    scope: "read:user user:email",
    code_challenge_method: "S256",
  });
  const verifier = github.forms[0]?.get("code_verifier") ?? "";
  expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
    location.searchParams.get("code_challenge") ?? "",
  );
  expect(back.status).toBe(302);
  expect(back.headers.get("location")).toBe("/new");
  const set = back.headers.getSetCookie().find((line) => line.startsWith("__Host-ob_session="));
  expect(set).toMatch(/^__Host-ob_session=[\w-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  const answer = await sessionAt(app, session);
  expect(answer).toMatchObject({
    signedIn: true,
    person: { handle: "ada", name: "Ada Lovelace", email: "ada@example.test", providers: ["github"] },
    csrf: expect.stringMatching(/^[\w-]{43}$/),
  });
  expect(answer.person?.principal).toMatch(/^ob:user:u_[a-z2-7]{16}$/);
});

test("a callback whose state is not the one this browser started is refused, with no session", async () => {
  const { app } = start();
  const started = await get(app, "/auth/github/start");
  const pending = `__Host-ob_signin=${cookiesOf(started)["__Host-ob_signin"]}`;
  const response = await get(app, "/auth/github/callback?code=example-code&state=forged", pending);
  expect(response.status).toBe(401);
  expect(await errorCode(response)).toBe("unauthorized");
  expect(cookiesOf(response)["__Host-ob_session"]).toBeUndefined();
});

test("with sign-up closed, a GitHub account no person holds is refused", async () => {
  const { app } = start({ signup: "closed" });
  const { back } = await signIn(app);
  expect(back.status).toBe(403);
  expect(await errorCode(back)).toBe("forbidden");
});

test("a provider that is not configured has no sign-in route", async () => {
  const { app } = start({ github: false });
  expect((await get(app, "/auth/github/start")).status).toBe(404);
  expect((await sessionAt(app)).providers).toEqual([]);
});

test("a session unused for 7 days, or carried with a bearer, does not sign in", async () => {
  const clock = { now: NOW };
  const { app } = start({ clock });
  const { session } = await signIn(app);
  const bearer = await app.fetch(
    new Request(`${PUBLIC_URL}/api/x/session`, { headers: { cookie: session, authorization: "Bearer other" } }),
  );
  expect(((await bearer.json()) as SessionState).signedIn).toBe(false);
  clock.now = NOW + 6 * DAY;
  expect((await sessionAt(app, session)).signedIn).toBe(true);
  clock.now = NOW + 12 * DAY;
  expect((await sessionAt(app, session)).signedIn).toBe(true);
  clock.now = NOW + 19 * DAY + 1;
  expect((await sessionAt(app, session)).signedIn).toBe(false);
});

test("a cookie-authenticated write needs this server's Origin and the session's CSRF value", async () => {
  store = openStore(() => NOW);
  const platform = store.platform();
  const identity = { provider: "github", subject: "1", login: "ada", name: "Ada", email: null, avatar: null };
  const idHash = createHash("sha256").update("a".repeat(43)).digest("hex");
  const session = { idHash, csrf: "c".repeat(43), expiresAt: NOW + DAY };
  await platform.signIn({ identity, admitNew: true, newPersonId: "u_aaaaaaaaaaaaaaaa", session, now: NOW });
  const write = (headers: Record<string, string>) =>
    sessionOf(
      new Request(`${PUBLIC_URL}/api/x/orgs`, {
        method: "POST",
        headers: { cookie: `__Host-ob_session=${"a".repeat(43)}`, ...headers },
      }),
      platform,
      NOW,
      PUBLIC_URL,
    );
  await expect(write({ origin: PUBLIC_URL })).rejects.toBeInstanceOf(BoardError);
  await expect(write({ "x-ob-csrf": session.csrf, origin: "https://evil.test" })).rejects.toBeInstanceOf(BoardError);
  expect((await write({ "x-ob-csrf": session.csrf, origin: PUBLIC_URL }))?.person.handle).toBe("ada");
});
