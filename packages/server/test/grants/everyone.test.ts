import { expect, test } from "bun:test";
import type { createConnection, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

test("everyone narrows a connection until a named grant wins at the same pattern", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/x/connections", {
      name: "ops",
      can: { "*": ["read", "post"] },
      direct: true,
    });
    expect(created.status).toBe(201);
    const { secret, connection } = (await created.json()) as OutputOf<typeof createConnection>;
    const add = (body: unknown) => call(app, "POST", "/grants", body);
    expect((await add({ principals: [{ kind: "everyone" }], can: { "ops/": ["read"] } })).status).toBe(200);
    const outsider = await call(app, "GET", "/grants/explain?channel=ops/x&github=acme/web");
    expect(await outsider.json()).toMatchObject({ pattern: null, can: [] });

    const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
    const post = () =>
      app.fetch(
        new Request(`${BOARD_URL}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ channel: "ops/x", text: "test" }),
        }),
      );
    expect((await app.fetch(new Request(`${BOARD_URL}/messages?channel=ops/x`, { headers }))).status).toBe(200);
    const denied = await post();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "forbidden" } });

    const named = { kind: "connection", connection: connection.id };
    expect((await add({ principals: [named], can: { "ops/": ["post"] } })).status).toBe(200);
    expect((await post()).status).toBe(201);
  } finally {
    await app.close();
  }
});
