import { expect, test } from "bun:test";
import type { ClaimResult, CreatedConnection, ManagedConnection } from "@openboard/contract";
import { hashToken } from "../src/auth/secrets.ts";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, NOW, OWNER, PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";

const SECRET = /^obc_[a-z2-7]{16}_[A-Za-z0-9_-]{43}$/;

test("POST /x/connections creates a connection with its grant and answers its secret once", async () => {
  const logged: unknown[] = [];
  const app = makeApp({ log: { info: (_, fields) => logged.push(fields), error: (_, fields) => logged.push(fields) } });
  try {
    const response = await call(app, "POST", "/x/connections", { name: "laptop", can: { "*": "all" }, direct: true });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { secret: string; [field: string]: unknown };
    expect(body.secret).toMatch(SECRET);
    const id = `cn_${body.secret.slice(4, 20)}`;
    expect(body).toEqual({
      connection: {
        id,
        principal: `ob:conn:${id}`,
        name: "laptop",
        grant: "g4",
        can: { "*": ["read", "post", "react", "label", "sync", "manage"] },
        direct: true,
        profiles: ["*"],
        secretHint: `…${body.secret.slice(-4)}`,
        createdBy: LOCAL_OWNER,
        createdAt: "2023-11-14T22:13:20.000Z",
      },
      secret: body.secret,
      env: { BOARD_URL, BOARD_TOKEN: body.secret },
    });
    const second = await call(app, "POST", "/x/connections", { name: "ci", can: { "dev/": ["post", "read"] } });
    expect(await second.json()).toMatchObject({ connection: { grant: "g5", can: { "dev/": ["read", "post"] } } });
    expect(JSON.stringify(logged)).not.toContain(body.secret);
    expect(JSON.stringify(logged)).not.toContain(hashToken(body.secret));
  } finally {
    await app.close();
  }
});

test("POST /x/connections keeps the connection's record off the feed", async () => {
  const app = makeApp();
  try {
    await call(app, "POST", "/x/connections", { name: "laptop", can: { "*": "all" } });
    const events = await call(app, "GET", "/events?after=0");
    expect(await events.json()).toMatchObject({ events: [], cursor: "1" });
  } finally {
    await app.close();
  }
});

test("POST /x/connections answers 409 slug_taken for a name the board already uses", async () => {
  const app = makeApp();
  try {
    expect((await call(app, "POST", "/x/connections", { name: "laptop", can: { "*": "all" } })).status).toBe(201);
    const again = await call(app, "POST", "/x/connections", { name: "laptop", can: { dev: ["read"] } });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "slug_taken" } });
  } finally {
    await app.close();
  }
});

test.each([
  [{ name: "laptop", can: { "Dev/": "all" } }, 400, "invalid_grant"],
  [{ name: "laptop", can: {} }, 400, "grant_empty"],
  [{ name: "laptop", can: { dev: [] } }, 400, "grant_empty"],
  [{ name: "Laptop!", can: { "*": "all" } }, 400, "invalid_request"],
  [{ name: "laptop", can: { "*": ["write"] } }, 400, "invalid_request"],
  [{ name: "laptop", can: { "*": "all" }, secret: "chosen" }, 400, "invalid_request"],
])("POST /x/connections refuses %j with %d %s", async (body, status, code) => {
  const app = makeApp();
  try {
    const response = await call(app, "POST", "/x/connections", body);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  } finally {
    await app.close();
  }
});

test("POST /x/connections needs a credential", async () => {
  const app = makeApp();
  try {
    const request = new Request(`${BOARD_URL}/x/connections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "laptop", can: { "*": "all" } }),
    });
    const response = await app.fetch(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  } finally {
    await app.close();
  }
});

function bearer(app: ReturnType<typeof makeApp>, token: string, path: string, method = "GET", body?: object) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const init = { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) };
  return app.fetch(new Request(BOARD_URL + path, init));
}

test("GET /x/connections lists each connection with its live agents, last use and hint, never a secret", async () => {
  const clock = { now: NOW };
  const app = makeApp({ now: () => clock.now });
  try {
    const create = async (name: string, direct: boolean) =>
      (await (
        await call(app, "POST", "/x/connections", { name, can: { "*": "all" }, direct })
      ).json()) as CreatedConnection;
    const laptop = await create("laptop", true);
    const fixers = await create("fixers", false);
    const gone = await create("gone", true);
    expect((await call(app, "POST", `/x/connections/${gone.connection.id}/revoke`)).status).toBe(200);
    clock.now = NOW + 60_000;
    const claimed = await bearer(app, fixers.secret, "/x/connections/claim", "POST", { profile: "Fixer-2" });
    const { agent, token } = (await claimed.json()) as ClaimResult;
    clock.now = NOW + 90_000;
    const posted = await app.fetch(
      new Request(`${BOARD_URL}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${laptop.secret}`,
          "x-board-profile": "me",
          "content-type": "application/json",
        },
        body: JSON.stringify({ channel: "dev", text: "hello" }),
      }),
    );
    expect(posted.status).toBe(201);
    clock.now = NOW + 120_000;

    const response = await call(app, "GET", "/x/connections");
    expect(response.status).toBe(200);
    const text = await response.text();
    const lastUsedAt = "2023-11-14T22:14:20.000Z";
    expect(JSON.parse(text)).toEqual({
      connections: [
        { ...fixers.connection, lastUsedAt, agents: [{ ...agent, profile: "Fixer-2", createdAt: lastUsedAt }] },
        { ...laptop.connection, lastUsedAt: "2023-11-14T22:14:50.000Z", agents: [] },
      ],
    });
    expect(fixers.connection.secretHint).toBe(`…${fixers.secret.slice(-4)}`);
    for (const secret of [laptop.secret, fixers.secret, token, "obc_", "obt_"]) expect(text).not.toContain(secret);

    const one = await call(app, "GET", `/x/connections/${fixers.connection.id}`);
    expect(await one.json()).toEqual({
      connection: (JSON.parse(text) as { connections: ManagedConnection[] }).connections[0],
    });
    for (const id of [gone.connection.id, "cn_zzzzzzzzzzzzzzzz"]) {
      const missing = await call(app, "GET", `/x/connections/${id}`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
    }
  } finally {
    await app.close();
  }
});

test("GET /x/connections is for the people who manage the board, not its connections or agents", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/x/connections", { name: "laptop", can: { "*": "all" }, direct: true });
    const { secret, connection } = (await created.json()) as CreatedConnection;
    const claimed = await bearer(app, secret, "/x/connections/claim", "POST", { profile: "fixer-1" });
    const { token } = (await claimed.json()) as ClaimResult;
    for (const path of ["/x/connections", `/x/connections/${connection.id}`]) {
      for (const credential of [secret, token]) {
        const refused = await bearer(app, credential, path);
        expect(refused.status).toBe(403);
        expect(await refused.json()).toMatchObject({ error: { code: "forbidden" } });
      }
      expect((await app.fetch(new Request(BOARD_URL + path))).status).toBe(401);
    }
  } finally {
    await app.close();
  }
});

test("GET /x/connections answers an organization owner and hides the board from outsiders", async () => {
  const app = makeBrowserApp(OWNER.hash);
  try {
    const ada = await browserSession(app.fetch, "ada");
    const org = new Request(`${PUBLIC_URL}/api/x/orgs`, {
      method: "POST",
      headers: ada.headers,
      body: JSON.stringify({ name: "Acme", slug: "acme" }),
    });
    expect((await app.fetch(org)).status).toBe(201);
    const list = (headers: Record<string, string>) =>
      app.fetch(new Request(`${PUBLIC_URL}/api/acme/main/x/connections`, { headers }));
    const answered = await list({ cookie: ada.headers.cookie ?? "" });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ connections: [] });
    const outsider = await browserSession(app.fetch, "lin");
    expect((await list({ cookie: outsider.headers.cookie ?? "" })).status).toBe(404);
  } finally {
    await app.close();
  }
});
