import { expect, test } from "bun:test";
import type { ClaimResult } from "@openboard/contract";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";

test("six refreshes succeed, the seventh returns 429, and the current token and sibling agent still work", async () => {
  let now = NOW;
  const cluster = makeApp({ now: () => now });
  // The bucket is per instance, including when the Postgres harness starts two.
  try {
    const [app] = cluster.instances;
    if (!app) throw new Error("expected a server instance");
    const connection = await call(app, "POST", "/x/connections", { name: "fixers", can: { dev: ["read"] } });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as { secret: string };

    const claim = async (profile: string) => {
      const response = await app.fetch(
        new Request(`${BOARD_URL}/x/connections/claim`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify({ profile }),
        }),
      );
      return tokenFrom(response);
    };
    const refresh = (token: string) =>
      app.fetch(
        new Request(`${BOARD_URL}/x/connections/refresh`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        }),
      );

    let token = await claim("fixer-1");
    const sibling = await claim("fixer-2");
    for (let i = 0; i < 6; i++) token = await tokenFrom(await refresh(token));

    const limited = await refresh(token);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("10");
    expect(await limited.json()).toMatchObject({ error: { code: "rate_limited" } });
    const me = await app.fetch(new Request(`${BOARD_URL}/me`, { headers: { authorization: `Bearer ${token}` } }));
    expect(me.status).toBe(200);
    await tokenFrom(await refresh(sibling));

    now += 60_000;
    await tokenFrom(await refresh(token));
  } finally {
    await cluster.close();
  }
});

async function tokenFrom(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  return ((await response.json()) as typeof ClaimResult.static).token;
}
