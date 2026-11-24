import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  BoardError,
  type ErrorBody,
  type OutputOf,
  type pollDeviceSignIn,
  type SessionState,
  type startDeviceSignIn,
} from "@openboard/contract";
import type { Store } from "@openboard/ports";
import { sessionOf } from "../src/auth/sessions.ts";
import type { App, ServerConfig } from "../src/index.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL, unexpectedTimer } from "./support/app.ts";
import { createCluster } from "./support/cluster.ts";
import { openStore } from "./support/drivers.ts";
import { CLIENT, cookiesOf, fakeGitHub, signIn } from "./support/sign-in.ts";

const DAY = 86_400_000;

let app: App | undefined;
let store: Store | undefined;
afterEach(async () => {
  await app?.close();
  await store?.close();
  app = store = undefined;
});

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
  const deps = {
    schedule: unexpectedTimer,
    now: () => clock.now,
    requestId: () => "req-1",
    randomBytes,
    log: { info() {}, error() {} },
  };
  app = createCluster(config, { store: openStore(() => clock.now) }, { ...deps, fetch: github.fetch });
  return { app, github };
}

const get = (target: App, path: string, cookie?: string) =>
  target.fetch(new Request(`${PUBLIC_URL}${path}`, { headers: cookie ? { cookie } : {} }));

const sessionAt = async (target: App, cookie?: string) =>
  (await (await get(target, "/api/x/session", cookie)).json()) as SessionState;
const errorCode = async (response: Response) => ((await response.json()) as { error: ErrorBody }).error.code;

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
  const [value, csrf] = ["a".repeat(43), "c".repeat(43)];
  const session = { idHash: createHash("sha256").update(value).digest("hex"), csrf, expiresAt: NOW + DAY };
  await platform.signIn({ identity, admitNew: true, newPersonId: "u_aaaaaaaaaaaaaaaa", session, now: NOW });
  const post = (headers: object) =>
    new Request(`${PUBLIC_URL}/api/x/orgs`, {
      method: "POST",
      headers: { cookie: `__Host-ob_session=${value}`, ...headers },
    });
  const write = (headers: object) => sessionOf(post(headers), platform, NOW, PUBLIC_URL);
  const origin = PUBLIC_URL;
  for (const refused of [{ origin }, { "x-ob-csrf": csrf }, { "x-ob-csrf": "é".repeat(43), origin }]) {
    await expect(write(refused)).rejects.toBeInstanceOf(BoardError);
  }
  expect((await write({ "x-ob-csrf": csrf, origin }))?.person.handle).toBe("ada");
});

test("signing out revokes the session and deletes its cookie, once the CSRF proof is shown", async () => {
  const { app } = start();
  const { session } = await signIn(app);
  const { csrf } = await sessionAt(app, session);
  const logout = (headers: Record<string, string>) =>
    app.fetch(new Request(`${PUBLIC_URL}/auth/logout`, { method: "POST", headers: { cookie: session, ...headers } }));
  const forged = await logout({ origin: "https://elsewhere.example", "x-ob-csrf": csrf ?? "" });
  expect(forged.status).toBe(403);
  expect(await errorCode(forged)).toBe("forbidden");
  expect((await sessionAt(app, session)).signedIn).toBe(true);
  const out = await logout({ origin: PUBLIC_URL, "x-ob-csrf": csrf ?? "" });
  expect(out.status).toBe(204);
  expect(out.headers.getSetCookie()).toEqual(["__Host-ob_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0"]);
  expect(await sessionAt(app, session)).toMatchObject({ signedIn: false, person: null, csrf: null });
  expect((await logout({ origin: PUBLIC_URL, "x-ob-csrf": csrf ?? "" })).status).toBe(204);
});

test("signing out everywhere revokes both browser sessions of the signed-in person", async () => {
  const { app } = start();
  const first = (await signIn(app)).session;
  const second = (await signIn(app)).session;
  expect(first).not.toBe(second);
  const firstState = await sessionAt(app, first);
  const secondState = await sessionAt(app, second);
  expect(firstState.signedIn).toBe(true);
  expect(secondState.signedIn).toBe(true);
  expect(firstState.person).toEqual(secondState.person);

  const path = "/api/x/me/sessions/revoke-all";
  const post = (headers: Record<string, string>) =>
    app.fetch(new Request(`${PUBLIC_URL}${path}`, { method: "POST", headers: { origin: PUBLIC_URL, ...headers } }));
  const anonymous = await post({});
  expect(anonymous.status).toBe(401);
  expect(await errorCode(anonymous)).toBe("unauthorized");
  const refused = await post({ cookie: first, "x-ob-csrf": secondState.csrf ?? "" });
  expect(refused.status).toBe(403);
  expect(await errorCode(refused)).toBe("forbidden");
  expect((await sessionAt(app, first)).signedIn).toBe(true);
  expect((await sessionAt(app, second)).signedIn).toBe(true);

  const response = await post({ cookie: first, "x-ob-csrf": firstState.csrf ?? "" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  for (const cookie of [first, second]) {
    expect(await sessionAt(app, cookie)).toMatchObject({ signedIn: false, person: null, csrf: null });
    const me = await get(app, "/api/x/me", cookie);
    expect(me.status).toBe(401);
    expect(await errorCode(me)).toBe("unauthorized");
  }
});

function post(target: App, path: string, body: unknown, headers?: Record<string, string>) {
  return target.fetch(
    new Request(`${PUBLIC_URL}/api/x${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers,
    }),
  );
}

async function deviceFixture() {
  const clock = { now: NOW };
  const { app } = start({ clock });
  const { session: cookie } = await signIn(app);
  const { csrf } = await sessionAt(app, cookie);
  const headers = { cookie, origin: PUBLIC_URL, "x-ob-csrf": csrf ?? "" };
  expect((await post(app, "/orgs", { name: "Acme", slug: "acme" }, headers)).status).toBe(201);
  const response = await post(app, "/auth/device", { clientName: "ob" });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const { deviceCode, userCode, interval, expiresIn } = (await response.json()) as OutputOf<typeof startDeviceSignIn>;
  return {
    app,
    clock,
    headers,
    cookie,
    interval,
    expiresIn,
    poll: () => post(app, "/auth/device/token", { deviceCode }),
    approve: (withHeaders?: Record<string, string>, org = "acme") =>
      post(app, "/auth/device/approve", { userCode, org }, withHeaders),
  };
}

test("the approved device code is exchanged once for a personal credential with its organization and boards", async () => {
  const { app, clock, headers, interval, poll, approve } = await deviceFixture();
  expect(await (await poll()).json()).toEqual({ pending: true });
  expect((await poll()).status).toBe(429);
  expect((await approve()).status).toBe(401);
  expect((await approve({ cookie: headers.cookie, "x-ob-csrf": headers["x-ob-csrf"] })).status).toBe(403);
  expect((await approve(headers, "local")).status).toBe(404);
  expect(await (await approve(headers)).json()).toEqual({ ok: true });
  expect((await approve(headers)).status).toBe(404);

  clock.now += interval * 1000;
  const answers = await Promise.all([poll(), poll()]);
  expect(answers.map(({ status }) => status).sort()).toEqual([200, 404]);
  const issued = answers.find((answer) => answer.ok);
  if (!issued) throw new Error("no device poll succeeded");
  expect(issued.headers.get("cache-control")).toBe("no-store");
  const issuedToken = (await issued.json()) as OutputOf<typeof pollDeviceSignIn>;
  if (!("token" in issuedToken)) throw new Error("approved device still pending");
  const { token, org, boards } = issuedToken;
  expect(typeof token === "string" && token.startsWith("obp_")).toBe(true);
  expect(org).toEqual({ slug: "acme", name: "Acme" });
  expect(boards).toEqual([{ slug: "main", name: "main", url: `${PUBLIC_URL}/api/acme/main` }]);
  const me = (slug: string) =>
    app.fetch(
      new Request(`${PUBLIC_URL}/api/${slug}/main/me`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  const expiresAt = clock.now + 30 * DAY;
  expect(await (await me("acme")).json()).toMatchObject({
    expiresAt,
    openboard: { credential: "personal", org, role: "owner" },
  });
  expect((await me("local")).status).toBe(404);
  const posted = await app.fetch(
    new Request(`${PUBLIC_URL}/api/acme/main/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: "dev", text: "hi" }),
    }),
  );
  expect(posted.status).toBe(201);
  clock.now = expiresAt;
  expect((await me("acme")).status).toBe(401);
});

test("approval and exchange both refuse an expired device code", async () => {
  const { clock, headers, expiresIn, poll, approve } = await deviceFixture();
  clock.now += expiresIn * 1000;
  expect((await approve(headers)).status).toBe(404);
  expect((await poll()).status).toBe(404);
});

test("a NUL in a device client name is rejected before storage", async () => {
  const { app } = start();
  expect((await post(app, "/auth/device", { clientName: "laptop\u0000" })).status).toBe(400);
});
