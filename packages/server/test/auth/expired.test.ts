import { afterEach, expect, test } from "bun:test";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

const CAN = { "dev/": ["read", "post"] };
const FIVE_MINUTES = 300_000;
const ONE_DAY = 86_400_000;

/** An app whose clock the test moves, with the connection `fixers` (tokens capped at 24h) created by the local owner. */
async function boot(): Promise<{ app: App; clock: { now: number }; secret: string }> {
  const clock = { now: NOW };
  const target = makeApp({ now: () => clock.now });
  const body = { name: "fixers", can: CAN, profiles: ["fixer-*"] };
  const response = await call(target, "POST", "/x/connections", body);
  expect(response.status).toBe(201);
  return { app: target, clock, secret: ((await response.json()) as { secret: string }).secret };
}

function as(target: App, token: string, method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { authorization: `Bearer ${token}` } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return target.fetch(new Request(`${BOARD_URL}${path}`, init));
}

async function tokenOf(response: Promise<Response>): Promise<string> {
  const answered = await response;
  expect(answered.status).toBe(200);
  return ((await answered.json()) as { token: string }).token;
}

async function codeOf(response: Promise<Response>): Promise<[number, string]> {
  const answered = await response;
  return [answered.status, ((await answered.json()) as { error: { code: string } }).error.code];
}

const claim = (booted: { app: App; secret: string }, ttl: string) =>
  tokenOf(as(booted.app, booted.secret, "POST", "/x/connections/claim", { profile: "fixer-2", ttl }));

test("a token claimed for 5m works until its expiresAt, then answers 401 unauthorized, refresh included", async () => {
  const booted = await boot();
  app = booted.app;
  const token = await claim(booted, "5m");
  booted.clock.now = NOW + FIVE_MINUTES - 1;
  expect((await as(app, token, "GET", "/me")).status).toBe(200);
  booted.clock.now = NOW + FIVE_MINUTES;
  expect(await codeOf(as(app, token, "GET", "/me"))).toEqual([401, "unauthorized"]);
  expect(await codeOf(as(app, token, "POST", "/x/connections/refresh"))).toEqual([401, "unauthorized"]);
});

test("a refreshed token lives to its new expiresAt, and its predecessor never past the hard expiry", async () => {
  const booted = await boot();
  app = booted.app;
  const first = await claim(booted, "1d");
  booted.clock.now = NOW + ONE_DAY - 10;
  const renewed = await tokenOf(as(app, first, "POST", "/x/connections/refresh"));
  booted.clock.now = NOW + ONE_DAY - 1;
  expect((await as(app, first, "GET", "/me")).status).toBe(200);
  expect((await as(app, renewed, "GET", "/me")).status).toBe(200);
  booted.clock.now = NOW + ONE_DAY;
  expect(await codeOf(as(app, first, "GET", "/me"))).toEqual([401, "unauthorized"]);
  expect(await codeOf(as(app, renewed, "GET", "/me"))).toEqual([401, "unauthorized"]);
});
