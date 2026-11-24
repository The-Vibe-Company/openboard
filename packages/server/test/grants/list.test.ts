import { expect, test } from "bun:test";
import type { createConnection, GrantView, listGrants, OutputOf } from "@openboard/contract";
import { seed } from "../isolation/seed.ts";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

type Made = OutputOf<typeof createConnection>;

function get(app: { fetch(request: Request): Promise<Response> }, token: string) {
  return app.fetch(new Request(BOARD_URL + "/grants", { headers: { authorization: `Bearer ${token}` } }));
}

test("GET /grants lists the starting grants and every unrevoked grant, oldest first, in the upstream view", async () => {
  const app = makeApp();
  try {
    const dev = (await (
      await call(app, "POST", "/x/connections", { name: "dev", can: { dev: "all" }, direct: true })
    ).json()) as Made;
    const gone = (await (
      await call(app, "POST", "/x/connections", { name: "gone", can: { "*": "all" }, direct: true })
    ).json()) as Made;
    const created = await call(app, "POST", "/grants", {
      principals: [{ kind: "all-connections" }],
      can: { "*": ["read"], "deploys/": ["read", "post"] },
    });
    const { grant } = (await created.json()) as { grant: GrantView };
    expect((await call(app, "POST", `/x/connections/${gone.connection.id}/revoke`)).status).toBe(200);
    const response = await call(app, "GET", "/grants");
    expect(response.status).toBe(200);
    const { grants } = (await response.json()) as OutputOf<typeof listGrants>;
    expect(grants.map(({ id }) => id)).toEqual(["g1", "g2", "g3", dev.connection.grant, grant.id]);
    expect(grants[0]).toEqual({
      id: "g1",
      principals: [{ kind: "all-users" }],
      can: { "*": "all" },
      capped: true,
      by: null,
      at: null,
    });
    expect(grants[1]?.principals).toEqual([
      { kind: "all-projects", environments: ["production", "preview", "development"] },
    ]);
    expect(grants[2]?.principals).toEqual([{ kind: "all-apps" }]);
    expect(grants[3]).toMatchObject({
      principals: [{ kind: "connection", connection: dev.connection.id }],
      can: dev.connection.can,
      capped: false,
    });
    expect(grants[3]?.by).toBeString();
    expect(grants[3]?.at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(grants[4]).toEqual(grant);
  } finally {
    await app.close();
  }
});

test("GET /grants needs manage everywhere: a narrower connection and any claimed token get 403", async () => {
  const app = makeApp();
  try {
    const narrow = (await (
      await call(app, "POST", "/x/connections", { name: "dev", can: { dev: "all" }, direct: true })
    ).json()) as Made;
    const wide = (await (
      await call(app, "POST", "/x/connections", { name: "wide", can: { "*": "all" } })
    ).json()) as Made;
    const refused = await get(app, narrow.secret);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "forbidden" } });
    const claim = await app.fetch(
      new Request(BOARD_URL + "/x/connections/claim", {
        method: "POST",
        headers: { authorization: `Bearer ${wide.secret}`, "content-type": "application/json" },
        body: JSON.stringify({ profile: "fixer" }),
      }),
    );
    const { token } = (await claim.json()) as { token: string };
    const pinned = await get(app, token);
    expect(pinned.status).toBe(403);
    expect(await pinned.json()).toMatchObject({ error: { code: "forbidden" } });
  } finally {
    await app.close();
  }
});

test("GET /grants answers an organization owner with its own board's grants only", async () => {
  const { app, a, b, send } = await seed();
  try {
    for (const credential of [a.session, a.personal]) {
      const response = await send("GET", "/api/alpha/main/grants", credential);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(a.ids.connection ?? "");
      expect(text).not.toContain(b.ids.connection ?? "");
    }
    expect((await send("GET", "/api/alpha/main/grants", a.connection)).status).toBe(200);
  } finally {
    await app.close();
  }
});
