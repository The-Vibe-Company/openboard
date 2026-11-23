import { afterEach, expect, test } from "bun:test";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

/** An app whose clock the test moves, with the connection `fixers` created by the local owner, and its secret. */
async function boot(): Promise<{ app: App; clock: { now: number }; secret: string }> {
  const clock = { now: NOW };
  const target = makeApp({ now: () => clock.now });
  const body = { name: "fixers", can: { "dev/": ["read", "post"] }, profiles: ["fixer-*"] };
  const response = await call(target, "POST", "/x/connections", body);
  expect(response.status).toBe(201);
  return { app: target, clock, secret: ((await response.json()) as { secret: string }).secret };
}

function claim(target: App, secret: string, body: Record<string, unknown>) {
  const init = { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(body) };
  return target.fetch(new Request(`${BOARD_URL}/x/connections/claim`, init));
}

async function codeOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { error: { code: string } }).error.code];
}

test("claiming fixer-2 twice without an idempotencyKey answers 409 profile_taken the second time", async () => {
  const booted = await boot();
  app = booted.app;
  expect((await claim(app, booted.secret, { profile: "fixer-2" })).status).toBe(200);
  expect(await codeOf(await claim(app, booted.secret, { profile: "fixer-2" }))).toEqual([409, "profile_taken"]);
  expect(await codeOf(await claim(app, booted.secret, { profile: "Fixer-2" }))).toEqual([409, "profile_taken"]);
  expect((await claim(app, booted.secret, { profile: "fixer-3" })).status).toBe(200);
});

test("of two racing claims of one profile exactly one answers a token", async () => {
  const booted = await boot();
  app = booted.app;
  const racing = [claim(app, booted.secret, { profile: "fixer-2" }), claim(app, booted.secret, { profile: "fixer-2" })];
  const statuses = (await Promise.all(racing)).map((response) => response.status);
  expect(statuses.sort()).toEqual([200, 409]);
});

test("a profile whose agent's token expired is claimed again", async () => {
  const booted = await boot();
  app = booted.app;
  expect((await claim(app, booted.secret, { profile: "fixer-2", ttl: "5m" })).status).toBe(200);
  booted.clock.now = NOW + 300_000 - 1;
  expect(await codeOf(await claim(app, booted.secret, { profile: "fixer-2" }))).toEqual([409, "profile_taken"]);
  booted.clock.now = NOW + 300_000;
  expect((await claim(app, booted.secret, { profile: "fixer-2" })).status).toBe(200);
  expect(await codeOf(await claim(app, booted.secret, { profile: "fixer-2" }))).toEqual([409, "profile_taken"]);
});

test("a profile another connection's agent holds is still free on this one", async () => {
  const booted = await boot();
  app = booted.app;
  const other = await call(app, "POST", "/x/connections", { name: "others", can: { "dev/": ["read"] } });
  const secret = ((await other.json()) as { secret: string }).secret;
  expect((await claim(app, booted.secret, { profile: "fixer-2" })).status).toBe(200);
  expect((await claim(app, secret, { profile: "fixer-2" })).status).toBe(200);
});
