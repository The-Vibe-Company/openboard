import { expect, test } from "bun:test";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

test("a claim-only connection secret cannot read channel messages as a bearer", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/x/connections", {
      name: "fixers",
      can: { dev: ["read", "post"] },
    });
    expect(created.status).toBe(201);
    const { secret } = (await created.json()) as { secret: string };

    const response = await app.fetch(
      new Request(`${BOARD_URL}/messages?channel=dev`, { headers: { authorization: `Bearer ${secret}` } }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  } finally {
    await app.close();
  }
});
