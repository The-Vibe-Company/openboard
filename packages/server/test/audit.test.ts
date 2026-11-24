import { expect, test } from "bun:test";
import type { AuditEvent, ClaimResult, CreatedConnection } from "@openboard/contract";
import { hashToken } from "../src/auth/secrets.ts";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, OWNER, PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";

function bearer(app: ReturnType<typeof makeApp>, token: string, path: string, method = "GET", body?: object) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const init = { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) };
  return app.fetch(new Request(BOARD_URL + path, init));
}

/** A connection, an agent claimed with its secret, and the connection revoked: three configuration events. */
async function configure(app: ReturnType<typeof makeApp>) {
  const created = await call(app, "POST", "/x/connections", { name: "fixers", can: { "*": "all" } });
  const { secret, connection } = (await created.json()) as CreatedConnection;
  const claimed = await bearer(app, secret, "/x/connections/claim", "POST", {
    profile: "fixer-1",
    idempotencyKey: "k1",
  });
  const { agent, token } = (await claimed.json()) as ClaimResult;
  expect((await call(app, "POST", "/messages", { channel: "dev", text: "hello" })).status).toBe(201);
  expect((await call(app, "POST", `/x/connections/${connection.id}/revoke`)).status).toBe(200);
  return { secret, connection, agent, token };
}

test("GET /x/audit lists who created, claimed and revoked a connection, never a secret, and /events none of it", async () => {
  const app = makeApp();
  try {
    const { secret, connection, agent, token } = await configure(app);
    const response = await call(app, "GET", "/x/audit");
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as { events: AuditEvent[]; cursor: string };
    const owner = { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null };
    expect(body.events.map(({ type, actor }) => [type, actor])).toEqual([
      ["ob.connection.created", LOCAL_OWNER],
      ["ob.agent.claimed", connection.principal],
      ["ob.connection.revoked", LOCAL_OWNER],
    ]);
    expect(body.events[0]?.payload).toEqual({ connection, claims: null, by: owner });
    expect(body.events[1]?.payload).toMatchObject({ agent, connection: connection.id, profile: "fixer-1" });
    expect(body.events[2]).toMatchObject({
      cursor: "5",
      payload: { connection: connection.id, grant: connection.grant },
    });
    expect(body.cursor).toBe("5");
    for (const hidden of [secret, token, hashToken(secret), hashToken(token), "Hash", "claimKey", "obc_", "obt_"]) {
      expect(text).not.toContain(hidden);
    }

    const feed = await call(app, "GET", "/events?after=0&all=true");
    const types = ((await feed.json()) as { events: { type: string }[] }).events.map(({ type }) => type);
    expect(types).toEqual(["actor.seen", "message.posted"]);
  } finally {
    await app.close();
  }
});

test("GET /x/audit pages with after and limit, and refuses a cursor that is not the board's", async () => {
  const app = makeApp();
  try {
    await configure(app);
    const first = await call(app, "GET", "/x/audit?limit=2");
    const page = (await first.json()) as { events: AuditEvent[]; cursor: string };
    expect(page.events.map(({ cursor }) => cursor)).toEqual(["1", "2"]);
    expect(page.cursor).toBe("2");
    const next = await call(app, "GET", `/x/audit?after=${page.cursor}&limit=2`);
    expect(await next.json()).toMatchObject({ events: [{ type: "ob.connection.revoked" }], cursor: "5" });
    expect(await (await call(app, "GET", "/x/audit?after=5")).json()).toEqual({ events: [], cursor: "5" });
    for (const after of ["6", "x1"]) {
      const refused = await call(app, "GET", `/x/audit?after=${after}`);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { code: "invalid_cursor" } });
    }
  } finally {
    await app.close();
  }
});

test("GET /x/audit is for the people who manage the board, not its connections or agents", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/x/connections", { name: "laptop", can: { "*": "all" }, direct: true });
    const { secret } = (await created.json()) as CreatedConnection;
    const claimed = await bearer(app, secret, "/x/connections/claim", "POST", { profile: "fixer-1" });
    const { token } = (await claimed.json()) as ClaimResult;
    for (const credential of [secret, token]) {
      const refused = await bearer(app, credential, "/x/audit");
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { code: "forbidden" } });
    }
    expect((await app.fetch(new Request(`${BOARD_URL}/x/audit`))).status).toBe(401);
  } finally {
    await app.close();
  }
});

test("GET /x/audit answers an organization owner and hides the board from outsiders", async () => {
  const app = makeBrowserApp(OWNER.hash);
  try {
    const ada = await browserSession(app.fetch, "ada");
    const org = new Request(`${PUBLIC_URL}/api/x/orgs`, {
      method: "POST",
      headers: ada.headers,
      body: JSON.stringify({ name: "Acme", slug: "acme" }),
    });
    expect((await app.fetch(org)).status).toBe(201);
    const audit = (cookie: string) =>
      app.fetch(new Request(`${PUBLIC_URL}/api/acme/main/x/audit`, { headers: { cookie } }));
    const answered = await audit(ada.headers.cookie ?? "");
    expect(answered.status).toBe(200);
    expect(await answered.json()).toMatchObject({ events: [] });
    const outsider = await browserSession(app.fetch, "lin");
    expect((await audit(outsider.headers.cookie ?? "")).status).toBe(404);
  } finally {
    await app.close();
  }
});
