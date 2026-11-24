import { expect, test } from "bun:test";
import type { AuditEvent, createConnection, listGrants, OutputOf, updateGrant } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

test("updating a connection grant refreshes permissions and the principal index on the next request", async () => {
  const app = makeApp();
  try {
    const create = async (name: string, pattern: string) => {
      const response = await call(app, "POST", "/x/connections", {
        name,
        direct: true,
        can: { [pattern]: ["post"] },
      });
      expect(response.status).toBe(201);
      return (await response.json()) as OutputOf<typeof createConnection>;
    };
    const first = await create("deploy", "deploys/");
    const second = await create("other", "other/");
    const { grant: id } = first.connection;
    const request = (secret: string, method: string) =>
      app.fetch(
        new Request(`${BOARD_URL}/messages${method === "GET" ? "?channel=deploys/web" : ""}`, {
          method,
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          ...(method === "POST" ? { body: JSON.stringify({ channel: "deploys/web", text: "deploying" }) } : {}),
        }),
      );
    expect((await request(first.secret, "POST")).status).toBe(201);
    expect((await request(second.secret, "GET")).status).toBe(403);

    const path = `/grants/${id}`;
    const add = [{ kind: "connection", connection: second.connection.id }];
    const changed = await call(app, "PATCH", path, { add, can: { "deploys/": ["read"] } });
    expect(changed.status).toBe(200);
    const { grant } = (await changed.json()) as OutputOf<typeof updateGrant>;
    expect(grant).toMatchObject({
      id,
      principals: [{ kind: "connection", connection: first.connection.id }, ...add],
      can: { "deploys/": ["read"] },
    });
    expect((await request(first.secret, "POST")).status).toBe(403);
    expect((await request(second.secret, "GET")).status).toBe(200);

    expect((await call(app, "GET", `/x/connections/${second.connection.id}`)).status).toBe(200);
    expect((await call(app, "PATCH", path, { remove: add })).status).toBe(200);
    expect((await request(second.secret, "GET")).status).toBe(403);

    const replacement = { add, remove: [{ kind: "connection", connection: first.connection.id }] };
    expect((await call(app, "PATCH", path, replacement)).status).toBe(200);
    expect((await request(first.secret, "GET")).status).toBe(403);
    const revoke = await call(app, "POST", `/x/connections/${second.connection.id}/revoke`);
    expect(revoke.status).toBe(200);
    expect((await call(app, "PATCH", path, { can: { "*": "all" } })).status).toBe(200);
    const details = await call(app, "GET", `/x/connections/${first.connection.id}`);
    expect(details.status).toBe(200);
    expect(await details.json()).toMatchObject({
      connection: { grant: id, can: { "*": ["read", "post", "react", "label", "sync", "manage"] } },
    });

    const { events } = (await (await call(app, "GET", "/x/audit")).json()) as { events: AuditEvent[] };
    expect(events.filter(({ type }) => type === "ob.grant.updated")[0]).toMatchObject({ payload: { grant } });
  } finally {
    await app.close();
  }
});

test("an updated starting grant appears once in order and can still be revoked", async () => {
  const app = makeApp();
  try {
    expect((await call(app, "PATCH", "/grants/g2", { can: { "deploys/": ["read"] } })).status).toBe(200);
    const before = (await (await call(app, "GET", "/grants")).json()) as OutputOf<typeof listGrants>;
    expect(before.grants.map(({ id }) => id)).toEqual(["g1", "g2", "g3"]);
    expect(before.grants[1]?.can).toEqual({ "deploys/": ["read"] });
    expect(await (await call(app, "POST", "/grants/g2/revoke")).json()).toEqual({ revoked: true });
    expect((await call(app, "PATCH", "/grants/g2", { can: { "deploys/": ["read"] } })).status).toBe(404);
  } finally {
    await app.close();
  }
});

test("an update denied for a hidden grant reveals neither its patterns nor its existence", async () => {
  const app = makeApp();
  try {
    const hidden = await call(app, "POST", "/grants", {
      principals: [{ kind: "all-users" }],
      can: { "private/": ["read"] },
    });
    const { grant } = (await hidden.json()) as OutputOf<typeof updateGrant>;
    const connection = await call(app, "POST", "/x/connections", {
      name: "reader",
      direct: true,
      can: { "dev/": ["read"] },
    });
    const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
    const update = (id: string) =>
      app.fetch(
        new Request(`${BOARD_URL}/grants/${id}`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify({ can: { "dev/": ["read"] } }),
        }),
      );
    const denied = await update(grant.id);
    const absent = await update("g999");
    expect(denied.status).toBe(403);
    expect(absent.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: { code: "forbidden", message: "updating this grant needs manage wherever it reaches" },
    });
    expect(await absent.json()).toMatchObject({
      error: { code: "forbidden", message: "updating this grant needs manage wherever it reaches" },
    });
  } finally {
    await app.close();
  }
});
