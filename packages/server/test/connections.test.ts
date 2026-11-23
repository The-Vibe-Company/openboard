import { expect, test } from "bun:test";
import { hashToken } from "../src/auth/secrets.ts";
import { BOARD_URL, call, LOCAL_OWNER, makeApp } from "./support/app.ts";

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
        secretHint: `obc_…${body.secret.slice(-4)}`,
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
