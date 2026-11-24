import { expect, test } from "bun:test";
import type { AuditEvent, createConnection, listGrants, OutputOf, revokeGrant } from "@openboard/contract";
import { seed } from "../isolation/seed.ts";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

test("revoking a connection grant takes effect on its next request and repeated revocation changes nothing", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/x/connections", {
      name: "deploy",
      direct: true,
      can: { "deploys/": ["post"] },
    });
    expect(created.status).toBe(201);
    const { secret, connection } = (await created.json()) as OutputOf<typeof createConnection>;
    const { grant } = connection;
    const post = () =>
      app.fetch(
        new Request(`${BOARD_URL}/messages`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify({ channel: "deploys/web", text: "deploying" }),
        }),
      );
    expect((await post()).status).toBe(201);

    const path = `/grants/${grant}/revoke`;
    const results = await Promise.all([call(app, "POST", path), call(app, "POST", path, { lockMeOut: false })]);
    expect(results.map(({ status }) => status)).toEqual([200, 200]);
    const revoked = await Promise.all(
      results.map(async (response) => ((await response.json()) as OutputOf<typeof revokeGrant>).revoked),
    );
    expect(revoked.sort()).toEqual([false, true]);

    const refused = await post();
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "forbidden" } });
    const listed = (await (await call(app, "GET", "/grants")).json()) as OutputOf<typeof listGrants>;
    expect(listed.grants.map(({ id }) => id)).not.toContain(grant);
    const { events } = (await (await call(app, "GET", "/x/audit")).json()) as { events: AuditEvent[] };
    expect(events.filter(({ type }) => type === "ob.grant.revoked")).toEqual([
      expect.objectContaining({ payload: { grant } }),
    ]);
  } finally {
    await app.close();
  }
});

test("revoking a starting grant changes person access on that board without denying the owner grant management", async () => {
  const { app, store, a, b, send } = await seed();
  try {
    const base = "/api/alpha/main";
    const canPost = (credential: typeof a.session) =>
      send("POST", `${base}/messages`, credential, { channel: "deploys/web", text: "deploying" });
    expect((await canPost(a.personal)).status).toBe(201);
    const revoked = await send("POST", `${base}/grants/g1/revoke`, a.session);
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ revoked: true });

    for (const credential of [a.session, a.personal]) {
      expect((await canPost(credential)).status).toBe(403);
      const listed = (await (await send("GET", `${base}/grants`, credential)).json()) as OutputOf<typeof listGrants>;
      expect(listed.grants.map(({ id }) => id)).not.toContain("g1");
    }
    const other = (await (await send("GET", "/api/bravo/main/grants", b.session)).json()) as OutputOf<
      typeof listGrants
    >;
    expect(other.grants.map(({ id }) => id)).toContain("g1");
    expect(await (await send("POST", `${base}/grants/g1/revoke`, a.session)).json()).toEqual({ revoked: false });
  } finally {
    await app.close();
    await store.close();
  }
});

test("a scoped manager revokes within its reach and cannot distinguish foreign patterns from absent grants", async () => {
  const app = makeApp();
  try {
    const create = async (name: string, pattern: string) => {
      const response = await call(app, "POST", "/x/connections", {
        name,
        direct: true,
        can: { [pattern]: "all" },
      });
      expect(response.status).toBe(201);
      return (await response.json()) as OutputOf<typeof createConnection>;
    };
    const manager = await create("manager", "deploys/");
    const inside = await create("inside", "deploys/web");
    const outside = await create("outside", "private");
    const revoke = (id: string) =>
      app.fetch(
        new Request(`${BOARD_URL}/grants/${id}/revoke`, {
          method: "POST",
          headers: { authorization: `Bearer ${manager.secret}` },
        }),
      );
    const denied = await revoke(outside.connection.grant);
    const absent = await revoke("g999");
    expect(denied.status).toBe(403);
    expect(absent.status).toBe(403);
    const { error } = (await denied.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe("forbidden");
    expect(await absent.json()).toMatchObject({ error });
    expect(await (await revoke(inside.connection.grant)).json()).toEqual({ revoked: true });
  } finally {
    await app.close();
  }
});

test("a revoke checks management after an intervening revocation of the caller's grant", async () => {
  const app = makeApp();
  const finishBody = Promise.withResolvers<string>();
  let pending: Promise<Response> | undefined;
  try {
    const response = await call(app, "POST", "/x/connections", {
      name: "manager",
      direct: true,
      can: { "*": "all", private: ["read"] },
    });
    expect(response.status).toBe(201);
    const manager = (await response.json()) as OutputOf<typeof createConnection>;
    const headers = { authorization: `Bearer ${manager.secret}` };
    const created = await call(app, "POST", "/grants", {
      principals: [{ kind: "connection", connection: manager.connection.id }],
      can: { "deploys/": ["read"] },
    });
    expect(created.status).toBe(200);
    const { grant } = (await created.json()) as { grant: { id: string } };
    const target = `/grants/${grant.id}/revoke`;
    const request = (path: string) => new Request(BOARD_URL + path, { method: "POST", headers });
    expect((await app.fetch(new Request(`${BOARD_URL}/grants`, { headers }))).status).toBe(200);
    expect(await (await app.fetch(request("/grants/g999/revoke"))).json()).toEqual({ revoked: false });

    // A body read follows the pipeline's authentication and precedes the handler's write lock.
    const started = Promise.withResolvers<void>();
    const inFlight = request(target);
    Object.defineProperty(inFlight, "text", {
      value: () => {
        started.resolve();
        return finishBody.promise;
      },
    });
    pending = app.fetch(inFlight);
    const paused = await Promise.race([started.promise.then(() => true), pending.then(() => false)]);
    expect(paused).toBe(true);
    expect(await (await call(app, "POST", `/grants/${manager.connection.grant}/revoke`)).json()).toEqual({
      revoked: true,
    });
    finishBody.resolve("");
    expect((await pending).status).toBe(403);
    expect(await (await call(app, "POST", target)).json()).toEqual({ revoked: true });
  } finally {
    finishBody.resolve("");
    await pending;
    await app.close();
  }
});
