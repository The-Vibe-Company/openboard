import { expect, test } from "bun:test";
import type { ClaimResult } from "@openboard/contract";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";

const CLAIM = { profile: "fixer-2", idempotencyKey: "sbx-1" };

function as(app: ReturnType<typeof makeApp>, token: string, path: string, body?: unknown) {
  return app.fetch(
    new Request(`${BOARD_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function connect(app: ReturnType<typeof makeApp>, name: string) {
  const response = await call(app, "POST", "/x/connections", { name, claims: 1, can: { dev: ["read", "post"] } });
  expect(response.status).toBe(201);
  return ((await response.json()) as { secret: string }).secret;
}

test("two concurrent fixer-2 claims with sbx-1 both return 200 with the same agent ID", async () => {
  const app = makeApp();
  try {
    const secret = await connect(app, "fixers");
    const claim = (body: typeof CLAIM) => as(app, secret, "/x/connections/claim", body);
    const responses = await Promise.all([claim(CLAIM), claim(CLAIM)]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const [first, second] = (await Promise.all(responses.map((response) => response.json()))) as [
      typeof ClaimResult.static,
      typeof ClaimResult.static,
    ];
    expect(first.agent.id).toMatch(/^ag_/);
    expect(second.agent).toEqual(first.agent);
    expect(second.token).not.toBe(first.token);
    for (const { token } of [first, second]) expect((await as(app, token, "/me")).status).toBe(200);
    expect((await claim({ ...CLAIM, idempotencyKey: "sbx-2" })).status).toBe(410);
  } finally {
    await app.close();
  }
});

test("a key is scoped to its connection, stays bound to its profile, and cannot revive an expired agent", async () => {
  const clock = { now: NOW };
  const app = makeApp({ now: () => clock.now });
  try {
    const first = await connect(app, "fixers");
    const other = await connect(app, "other");
    const claim = (secret: string, body: typeof CLAIM & { can?: Record<string, string[]> } = CLAIM) =>
      as(app, secret, "/x/connections/claim", body);
    const initial = await claim(first);
    const separate = await claim(other);
    expect([initial.status, separate.status]).toEqual([200, 200]);
    const a = (await initial.json()) as typeof ClaimResult.static;
    const b = (await separate.json()) as typeof ClaimResult.static;
    expect(a.agent.id).not.toBe(b.agent.id);
    const narrower = await claim(first, { ...CLAIM, can: { dev: ["read"] } });
    expect(narrower.status).toBe(400);
    const wrongProfile = await claim(first, { ...CLAIM, profile: "fixer-3" });
    expect(wrongProfile.status).toBe(400);
    clock.now = NOW + 3_580_000;
    const retry = await claim(first);
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as typeof ClaimResult.static).agent).toEqual(a.agent);
    clock.now = NOW + 3_600_000;
    expect((await as(app, a.token, "/me")).status).toBe(401);
    const expired = await claim(first);
    expect(expired.status).toBe(401);
  } finally {
    await app.close();
  }
});
