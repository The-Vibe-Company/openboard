import { expect, test } from "bun:test";
import type { CanInput, createConnection, createGrant, listGrants, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

test("grants round-trip their written can and close a more specific pattern", async () => {
  const app = makeApp();
  try {
    const made = await call(app, "POST", "/x/connections", { name: "ops", can: { "*": "all" }, direct: true });
    expect(made.status).toBe(201);
    const { connection, secret } = (await made.json()) as OutputOf<typeof createConnection>;
    const can = {
      "ops/": ["read"],
      "ops/secret/": [],
      "other/": ["post", "read", "post"],
      example: "all",
    } satisfies CanInput;
    const created = await call(app, "POST", "/grants", {
      principals: [{ kind: "connection", connection: connection.id }],
      can,
    });
    expect(created.status).toBe(200);
    const { grant } = (await created.json()) as OutputOf<typeof createGrant>;
    expect(grant.can).toEqual(can);

    const listed = await call(app, "GET", "/grants");
    expect(listed.status).toBe(200);
    const { grants } = (await listed.json()) as OutputOf<typeof listGrants>;
    expect(grants.find(({ id }) => id === grant.id)?.can).toEqual(can);

    for (const channel of ["ops/web", "ops/secret/x"]) {
      expect((await call(app, "POST", "/messages", { channel, text: "seed" })).status).toBe(201);
    }

    const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
    const read = (channel: string) => app.fetch(new Request(`${BOARD_URL}/messages?channel=${channel}`, { headers }));
    const visible = await read("ops/web");
    expect(visible.status).toBe(200);
    expect(await visible.json()).toMatchObject({ messages: [{ text: "seed" }] });
    const hidden = await read("ops/secret/x");
    expect(hidden.status).toBe(403);
    expect(await hidden.json()).toMatchObject({ error: { code: "forbidden" } });
    const post = await app.fetch(
      new Request(`${BOARD_URL}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ channel: "ops/secret/x", text: "blocked" }),
      }),
    );
    expect(post.status).toBe(403);
    expect(await post.json()).toMatchObject({ error: { code: "forbidden" } });
  } finally {
    await app.close();
  }
});
