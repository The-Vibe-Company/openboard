import { expect, test } from "bun:test";
import type { GrantPrincipalInput } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

test("an owner can explain a connection's deciding grants, and a restricted connection cannot", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/x/connections", {
      name: "explained",
      can: { "*": ["read", "post"] },
      direct: true,
    });
    expect(created.status).toBe(201);
    const { connection, secret } = (await created.json()) as {
      connection: { id: string; grant: string };
      secret: string;
    };
    const path = "/grants/explain?channel=dev%2Fweb";
    const explain = async (id: string) => {
      const response = await call(app, "GET", `${path}&connection=${id}`);
      expect(response.status).toBe(200);
      return response.json();
    };
    const grant = async (principal: GrantPrincipalInput, pattern: string, permission: string) => {
      const response = await call(app, "POST", "/grants", {
        principals: [principal],
        can: { [pattern]: [permission] },
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { grant: { id: string } }).grant.id;
    };

    expect(await explain(connection.id)).toMatchObject({
      pattern: "*",
      level: "principal",
      grants: [{ id: connection.grant }],
      can: ["read", "post"],
    });
    const everyone = await grant({ kind: "everyone" }, "dev/", "read");
    expect(await explain(connection.id)).toMatchObject({
      pattern: "dev/",
      over: ["*"],
      level: "everyone",
      grants: [{ id: everyone }],
      can: ["read"],
    });
    const group = await grant({ kind: "all-connections" }, "dev/", "post");
    expect(await explain(connection.id)).toMatchObject({
      pattern: "dev/",
      over: ["*"],
      level: "group",
      grants: [{ id: group }],
      can: ["post"],
    });
    const own = await grant({ kind: "connection", connection: connection.id }, "dev/", "react");
    expect(await explain(connection.id)).toMatchObject({
      pattern: "dev/",
      over: ["*"],
      level: "principal",
      grants: [{ id: own }],
      can: ["read", "react"],
    });
    const absent = { channel: "dev/web", pattern: null, over: [], level: null, grants: [], capped: null, can: [] };
    expect(await explain("cn_zzzzzzzzzzzzzzzz")).toEqual(absent);

    const selected = `${path}&connection=${connection.id}`;
    const denied = await app.fetch(
      new Request(BOARD_URL + selected, { headers: { authorization: `Bearer ${secret}` } }),
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "forbidden" } });
    expect((await call(app, "GET", `${selected}&app=demo`)).status).toBe(400);

    expect((await call(app, "POST", `/x/connections/${connection.id}/revoke`)).status).toBe(200);
    expect(await explain(connection.id)).toEqual(absent);
  } finally {
    await app.close();
  }
});
