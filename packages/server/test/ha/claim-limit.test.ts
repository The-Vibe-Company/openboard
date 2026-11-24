import { expect, test } from "bun:test";
import type { CreatedConnection } from "@openboard/contract";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";
import { postgresTestUrl } from "../support/env.ts";

test("the 31st claim is rate limited across instances and spends no claim", async () => {
  let now = NOW;
  const app = makeApp({ now: () => now });
  try {
    expect(app.instances).toHaveLength(postgresTestUrl() ? 2 : 1);
    const connection = async (name: string, claims: number) => {
      const response = await call(app, "POST", "/x/connections", { name, claims, can: { "*": "all" } });
      expect(response.status).toBe(201);
      return ((await response.json()) as CreatedConnection).secret;
    };
    const claim = (secret: string, profile: string) =>
      app.fetch(
        new Request(`${BOARD_URL}/x/connections/claim`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
          body: JSON.stringify({ profile }),
        }),
      );

    const first = await connection("first", 31);
    const second = await connection("second", 1);
    for (let index = 1; index <= 30; index++) {
      expect((await claim(first, `agent-${index}`)).status).toBe(200);
    }
    if (postgresTestUrl()) {
      expect(app.served.slice(-30)).toEqual(Array.from({ length: 30 }, (_, index) => (index % 2) + 1));
    }
    const refused = await claim(first, "agent-31");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(refused.headers.get("retry-after")).toBe("40");
    expect((await claim(second, "agent-one")).status).toBe(200);

    now += 60_000;
    expect((await claim(first, "agent-31")).status).toBe(200);
    const spent = await claim(first, "agent-32");
    expect(spent.status).toBe(410);
    expect(await spent.json()).toMatchObject({ error: { code: "secret_spent" } });
  } finally {
    await app.close();
  }
});
