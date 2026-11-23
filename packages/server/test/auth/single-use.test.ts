import { afterEach, expect, test } from "bun:test";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;
let app: App | undefined;
afterEach(() => app?.close());

/** Creates the connection `sandbox` as the local owner, with `claims` when given, and answers its secret. */
async function connect(target: App, claims?: number | null): Promise<string> {
  const body = { name: "sandbox", can: { "dev/": ["read", "post"] }, ...(claims === undefined ? {} : { claims }) };
  const response = await call(target, "POST", "/x/connections", body);
  expect(response.status).toBe(201);
  return ((await response.json()) as { secret: string }).secret;
}

function claim(target: App, secret: string, profile = "fixer-2") {
  const init = { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ profile }) };
  return target.fetch(new Request(`${BOARD_URL}/x/connections/claim`, init));
}

async function codeOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { error: { code: string } }).error.code];
}

test("a single-use secret answers a token on its first claim and 410 secret_spent on the next", async () => {
  app = makeApp();
  const secret = await connect(app, 1);
  const first = await claim(app, secret);
  expect(first.status).toBe(200);
  expect(((await first.json()) as { token: string }).token).toStartWith("obt_");
  expect(await codeOf(await claim(app, secret, "fixer-3"))).toEqual([410, "secret_spent"]);
  expect(await codeOf(await claim(app, secret))).toEqual([410, "secret_spent"]);
});

test("of two racing claims of a single-use secret exactly one answers a token", async () => {
  app = makeApp();
  const secret = await connect(app, 1);
  const statuses = (await Promise.all([claim(app, secret, "fixer-2"), claim(app, secret, "fixer-3")])).map(
    (response) => response.status,
  );
  expect(statuses.sort()).toEqual([200, 410]);
});

test("a refused claim spends nothing, and a secret without claims keeps claiming", async () => {
  app = makeApp();
  const once = await connect(app, 1);
  const refused = await app.fetch(
    new Request(`${BOARD_URL}/x/connections/claim`, {
      method: "POST",
      headers: { authorization: `Bearer ${once}` },
      body: JSON.stringify({ profile: "fixer-2", can: { "ops/": ["read"] } }),
    }),
  );
  expect(await codeOf(refused)).toEqual([403, "forbidden"]);
  expect((await claim(app, once)).status).toBe(200);
  const response = await call(app, "POST", "/x/connections", { name: "open", can: { "*": "all" }, claims: null });
  expect(response.status).toBe(201);
  const open = ((await response.json()) as { secret: string }).secret;
  for (const profile of ["a", "b", "c"]) expect((await claim(app, open, profile)).status).toBe(200);
});

test("claims below one or not whole, or on a direct connection, answer 400 invalid_request", async () => {
  app = makeApp();
  const extras: Record<string, unknown>[] = [{ claims: 0 }, { claims: -1 }, { claims: 1.5 }, { claims: "1" }];
  for (const extra of [...extras, { claims: 1, direct: true }]) {
    const response = await call(app, "POST", "/x/connections", { name: "bad", can: { "*": "all" }, ...extra });
    expect(await codeOf(response)).toEqual([400, "invalid_request"]);
  }
});
