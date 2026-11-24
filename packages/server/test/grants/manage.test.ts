import { expect, test } from "bun:test";
import type { CanInput, createConnection, GrantView, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

async function direct(app: ReturnType<typeof makeApp>, can: CanInput) {
  const created = await call(app, "POST", "/x/connections", { name: "manager", can, direct: true });
  expect(created.status).toBe(201);
  const { secret } = (await created.json()) as OutputOf<typeof createConnection>;
  const send = (method: string, path: string, body?: unknown) =>
    app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method,
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return send;
}

async function forbidden(response: Response) {
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
}

test("a scoped manager can write above an everyone closure but cannot override it at its own pattern", async () => {
  const app = makeApp();
  try {
    const can = { "work/build/": "all" } as const;
    const send = await direct(app, can);
    const closed = { "work/build/private/": [] };
    expect((await call(app, "POST", "/grants", { principals: [{ kind: "everyone" }], can: closed })).status).toBe(200);
    const principals = [{ kind: "github", repository: "acme/repo" }];
    await forbidden(await send("POST", "/grants", { principals, can: closed }));
    const created = await send("POST", "/grants", { principals, can });
    expect(created.status).toBe(200);
    const { grant } = (await created.json()) as { grant: GrantView };
    const path = `/grants/${grant.id}`;
    expect((await send("PATCH", path, { can: { "work/build/": ["read"] } })).status).toBe(200);
    expect(await (await send("POST", `${path}/revoke`)).json()).toEqual({ revoked: true });
  } finally {
    await app.close();
  }
});

test("everyone admission applies to creates and widening updates, but not to revokes", async () => {
  const app = makeApp();
  try {
    const send = await direct(app, { "work/build/": "all" });
    const principals = [{ kind: "github", repository: "acme/repo" }];
    const can = { "work/build/": ["read"] };
    const created = await send("POST", "/grants", { principals, can });
    expect(created.status).toBe(200);
    const { grant } = (await created.json()) as { grant: GrantView };
    const path = `/grants/${grant.id}`;
    expect(
      (await call(app, "POST", "/grants", { principals: [{ kind: "everyone" }], can: { "public/": ["read"] } })).status,
    ).toBe(200);
    await forbidden(await send("POST", "/grants", { principals, can }));
    await forbidden(await send("PATCH", path, { can }));
    expect(await (await send("POST", `${path}/revoke`)).json()).toEqual({ revoked: true });
  } finally {
    await app.close();
  }
});
