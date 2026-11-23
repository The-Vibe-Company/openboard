import { afterEach, expect, test } from "bun:test";
import { hashToken } from "../../src/auth/secrets.ts";
import { BOARD_URL, call, makeApp, OWNER } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

const TOKEN = /^obt_[a-z2-7]{16}_[A-Za-z0-9_-]{43}$/;
const CAN = { "dev/": ["read", "post"] };

/** Creates the connection `fixers` as the local owner, without `direct` unless asked, and answers its secret. */
async function connect(target: App, direct = false): Promise<string> {
  const body = { name: "fixers", can: CAN, direct, profiles: ["fixer-*"] };
  const response = await call(target, "POST", "/x/connections", body);
  expect(response.status).toBe(201);
  return ((await response.json()) as { secret: string }).secret;
}

/** Sends a request with `token` as the bearer; a string body is sent as-is, like curl's `-d`. */
function as(target: App, token: string, method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { authorization: `Bearer ${token}` } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return target.fetch(new Request(`${BOARD_URL}${path}`, init));
}

interface Claimed {
  agent: { id: string; actor: string; [field: string]: unknown };
  token: string;
}

async function claim(target: App, secret: string, body: unknown = { profile: "fixer-2" }): Promise<Claimed> {
  const response = await as(target, secret, "POST", "/x/connections/claim", body);
  expect(response.status).toBe(200);
  return (await response.json()) as Claimed;
}

const principalOf = (secret: string) => `ob:conn:cn_${secret.slice(4, 20)}`;

async function codeOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { error: { code: string } }).error.code];
}

test("POST /x/connections/claim trades a connection's secret for an agent token pinned to the profile", async () => {
  const logged: unknown[] = [];
  app = makeApp({ log: { info: (_, fields) => logged.push(fields), error: (_, fields) => logged.push(fields) } });
  const secret = await connect(app);
  const response = await as(app, secret, "POST", "/x/connections/claim", '{"profile":"fixer-2"}');
  expect(response.status).toBe(200);
  const body = (await response.json()) as Claimed & { [field: string]: unknown };
  expect(body.token).toMatch(TOKEN);
  expect(body).toEqual({
    agent: {
      id: `ag_${body.token.slice(4, 20)}`,
      actor: `${principalOf(secret)}+fixer-2`,
      can: CAN,
      expiresAt: "2023-11-14T23:13:20.000Z",
      hardExpiresAt: "2023-11-15T22:13:20.000Z",
    },
    token: body.token,
    env: { BOARD_URL, BOARD_TOKEN: body.token, BOARD_PROFILE: "fixer-2" },
  });
  for (const credential of [secret, body.token]) {
    expect(JSON.stringify(logged)).not.toContain(credential);
    expect(JSON.stringify(logged)).not.toContain(hashToken(credential));
  }
  const events = await call(app, "GET", "/events?after=0");
  expect(await events.json()).toMatchObject({ events: [], cursor: "2" });
});

test("an agent token posts as its profile, shown as the profile via the connection", async () => {
  app = makeApp();
  const secret = await connect(app);
  const { token } = await claim(app, secret, { profile: "Fixer-2" });
  const response = await as(app, token, "POST", "/messages", { channel: "dev", text: "hi" });
  expect(response.status).toBe(201);
  const principal = principalOf(secret);
  const actor = `${principal}+fixer-2`;
  const author = {
    kind: "agent",
    handle: "fixers/fixer-2",
    name: "Fixer-2",
    avatar: null,
    via: { name: "fixers", environment: null },
  };
  expect(await response.json()).toMatchObject({ message: { by: { actor, principal, profile: "fixer-2" }, author } });
});

test("GET /me with an agent token names the agent credential and the claim's can", async () => {
  app = makeApp();
  const secret = await connect(app);
  const { token } = await claim(app, secret, { profile: "fixer-2", can: { dev: ["read"] }, ttl: "5m" });
  const response = await as(app, token, "GET", "/me");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    actor: `${principalOf(secret)}+fixer-2`,
    kind: "agent",
    handle: "fixers/fixer-2",
    profile: "fixer-2",
    can: { dev: ["read"] },
    openboard: { role: null, credential: "agent" },
  });
});

test("a claim names its ttl, never past the connection's cap", async () => {
  app = makeApp();
  const secret = await connect(app);
  const short = await claim(app, secret, { profile: "fixer-2", ttl: "5m" });
  expect(short.agent).toMatchObject({ expiresAt: "2023-11-14T22:18:20.000Z" });
  const long = await claim(app, secret, { profile: "fixer-3", ttl: "30d" });
  expect(long.agent).toMatchObject({
    expiresAt: "2023-11-15T22:13:20.000Z",
    hardExpiresAt: "2023-11-15T22:13:20.000Z",
  });
});

test("a direct connection's secret claims too", async () => {
  app = makeApp();
  const secret = await connect(app, true);
  expect((await claim(app, secret)).agent.actor).toBe(`${principalOf(secret)}+fixer-2`);
});

test("a claim for a profile the connection's patterns do not let in answers 403 forbidden", async () => {
  app = makeApp();
  const secret = await connect(app);
  const response = await as(app, secret, "POST", "/x/connections/claim", { profile: "reviewer" });
  expect(await codeOf(response)).toEqual([403, "forbidden"]);
});

test("only a connection's secret claims: the owner token and an agent token answer 403 forbidden", async () => {
  app = makeApp();
  const { token } = await claim(app, await connect(app));
  for (const bearer of [OWNER.token, token]) {
    const response = await as(app, bearer, "POST", "/x/connections/claim", { profile: "fixer-2" });
    expect(await codeOf(response)).toEqual([403, "forbidden"]);
  }
});

test.each([
  [{}, "invalid_request"],
  [{ profile: "fixer 2" }, "invalid_request"],
  [{ profile: "fixer-2", ttl: "1w" }, "invalid_request"],
  [{ profile: "fixer-2", idempotencyKey: "sbx-1" }, "invalid_request"],
  [{ profile: "fixer-2", can: { "Dev/": "all" } }, "invalid_grant"],
  [{ profile: "fixer-2", can: {} }, "grant_empty"],
])("POST /x/connections/claim refuses %j with 400 %s", async (body, code) => {
  app = makeApp();
  const secret = await connect(app);
  expect(await codeOf(await as(app, secret, "POST", "/x/connections/claim", body))).toEqual([400, code]);
});

test("an obt_ token that is forged or names no agent of the board answers 401 unauthorized", async () => {
  app = makeApp();
  const { token } = await claim(app, await connect(app));
  const forged = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  const unknown = `obt_${"a".repeat(16)}${token.slice(20)}`;
  for (const bearer of [forged, unknown, `${token}x`]) {
    expect(await codeOf(await as(app, bearer, "GET", "/me"))).toEqual([401, "unauthorized"]);
  }
});
