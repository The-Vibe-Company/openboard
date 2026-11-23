import { afterEach, expect, test } from "bun:test";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

const TOKEN = /^obt_[a-z2-7]{16}_[A-Za-z0-9_-]{43}$/;
const CAN = { "dev/": ["read", "post"] };

interface Agent {
  id: string;
  actor: string;
  can: unknown;
  expiresAt: string;
  hardExpiresAt: string;
}
interface Issued {
  agent: Agent;
  token: string;
  env: Record<string, string>;
}

/** An app whose clock the test moves, with the connection `fixers` created by the local owner. */
async function boot(): Promise<{ app: App; clock: { now: number }; secret: string }> {
  const clock = { now: NOW };
  const target = makeApp({ now: () => clock.now });
  const response = await call(target, "POST", "/x/connections", { name: "fixers", can: CAN, profiles: ["fixer-*"] });
  expect(response.status).toBe(201);
  return { app: target, clock, secret: ((await response.json()) as { secret: string }).secret };
}

/** Sends a request with `token` as the bearer, and no body. */
function as(target: App, token: string, method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { authorization: `Bearer ${token}` } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return target.fetch(new Request(`${BOARD_URL}${path}`, init));
}

async function issued(response: Promise<Response>): Promise<Issued> {
  const answered = await response;
  expect(answered.status).toBe(200);
  return (await answered.json()) as Issued;
}

const refresh = (target: App, token: string) => as(target, token, "POST", "/x/connections/refresh");

async function codeOf(response: Promise<Response>): Promise<[number, string]> {
  const answered = await response;
  return [answered.status, ((await answered.json()) as { error: { code: string } }).error.code];
}

test("POST /x/connections/refresh answers a new token for the same agent, with the same pins and a later expiry", async () => {
  const booted = await boot();
  app = booted.app;
  const claimed = await issued(
    as(app, booted.secret, "POST", "/x/connections/claim", { profile: "Fixer-2", ttl: "5m" }),
  );
  booted.clock.now = NOW + 120_000;
  const body = await issued(refresh(app, claimed.token));
  expect(body.token).toMatch(TOKEN);
  expect(body.token).not.toBe(claimed.token);
  expect(body.token.slice(0, 20)).toBe(claimed.token.slice(0, 20));
  expect(body).toEqual({
    agent: { ...claimed.agent, expiresAt: "2023-11-14T23:15:20.000Z" },
    token: body.token,
    env: { BOARD_URL, BOARD_TOKEN: body.token, BOARD_PROFILE: "Fixer-2" },
  });
  const me = await as(app, body.token, "GET", "/me");
  expect(me.status).toBe(200);
  expect(((await me.json()) as { actor: string }).actor).toBe(claimed.agent.actor);
});

test("the replaced token keeps working for 60 seconds, then answers 401, and never refreshes again", async () => {
  const booted = await boot();
  app = booted.app;
  const claimed = await issued(as(app, booted.secret, "POST", "/x/connections/claim", { profile: "fixer-2" }));
  const renewed = await issued(refresh(app, claimed.token));
  expect(await codeOf(refresh(app, claimed.token))).toEqual([401, "unauthorized"]);
  booted.clock.now = NOW + 59_999;
  expect((await as(app, claimed.token, "GET", "/me")).status).toBe(200);
  booted.clock.now = NOW + 60_000;
  expect(await codeOf(as(app, claimed.token, "GET", "/me"))).toEqual([401, "unauthorized"]);
  expect((await as(app, renewed.token, "GET", "/me")).status).toBe(200);
  const again = await issued(refresh(app, renewed.token));
  expect(await codeOf(as(app, claimed.token, "GET", "/me"))).toEqual([401, "unauthorized"]);
  expect((await as(app, renewed.token, "GET", "/me")).status).toBe(200);
  expect((await as(app, again.token, "GET", "/me")).status).toBe(200);
});

test("a refresh never moves the expiry past hardExpiresAt, and past it answers 401", async () => {
  const booted = await boot();
  app = booted.app;
  const claimed = await issued(as(app, booted.secret, "POST", "/x/connections/claim", { profile: "fixer-2" }));
  booted.clock.now = NOW + 86_000_000;
  const late = await issued(refresh(app, claimed.token));
  expect(late.agent.expiresAt).toBe(claimed.agent.hardExpiresAt);
  booted.clock.now = NOW + 86_400_000;
  expect(await codeOf(refresh(app, late.token))).toEqual([401, "unauthorized"]);
});

test("only a claimed agent token refreshes: a direct secret or the owner token is 403, a claim-only secret 401", async () => {
  const booted = await boot();
  app = booted.app;
  const direct = await call(app, "POST", "/x/connections", { name: "laptop", can: CAN, direct: true });
  const directSecret = ((await direct.json()) as { secret: string }).secret;
  expect(await codeOf(refresh(app, directSecret))).toEqual([403, "forbidden"]);
  expect(await codeOf(call(app, "POST", "/x/connections/refresh"))).toEqual([403, "forbidden"]);
  expect(await codeOf(refresh(app, booted.secret))).toEqual([401, "unauthorized"]);
});

test("two refreshes of one token at once: one answers a new token, the other 401", async () => {
  const booted = await boot();
  app = booted.app;
  const claimed = await issued(as(app, booted.secret, "POST", "/x/connections/claim", { profile: "fixer-2" }));
  const answers = await Promise.all([refresh(app, claimed.token), refresh(app, claimed.token)]);
  expect(answers.map((answer) => answer.status).sort()).toEqual([200, 401]);
});
