import { expect, test } from "bun:test";
import type { AuditEvent, createConnection, GrantPrincipalInput, GrantView, OutputOf } from "@openboard/contract";
import { seed } from "../isolation/seed.ts";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

test("POST /grants stores and shows every supported principal in the upstream view shape", async () => {
  const { app, a, send } = await seed();
  try {
    const userId = a.ids.member?.slice("ob:user:".length) ?? "";
    const connection = a.ids.connection ?? "";
    const principals = [
      { kind: "user", userId },
      { kind: "project", project: "prj_example", environments: ["preview", "production"] },
      { kind: "github", repository: "example/web", workflow: "ci.yml", branch: "refs/heads/main" },
      { kind: "oidc", issuer: "https://issuer.example", claims: { sub: ["project:example/*", "project:example/*"] } },
      { kind: "all-users" },
      { kind: "all-projects", environments: ["production"] },
      { kind: "everyone" },
      { kind: "app", app: "app_example" },
      { kind: "all-apps" },
      { kind: "connection", connection },
      { kind: "all-connections" },
    ] as const satisfies GrantPrincipalInput[];
    const can = { "deploys/": "all" } as const;
    const base = "/api/alpha/main";
    const response = await send("POST", `${base}/grants`, a.session, { principals, can });
    expect(response.status).toBe(200);
    const { grant } = (await response.json()) as { grant: GrantView };
    expect(grant).toEqual({
      id: "g8",
      by: a.ids.member ?? "",
      at: "2023-11-14T22:13:20.000Z",
      capped: false,
      can,
      principals: [
        { kind: "user", userId, email: null },
        {
          kind: "project",
          projectId: "prj_example",
          environments: ["production", "preview"],
          name: null,
          teamId: null,
        },
        {
          kind: "github",
          repository: "example/web",
          repositoryId: null,
          workflow: ".github/workflows/ci.yml",
          branch: "main",
        },
        { kind: "oidc", issuer: "https://issuer.example", claims: { sub: "project:example/*" } },
        principals[4],
        principals[5],
        principals[6],
        { kind: "app", clientId: "app_example", name: null },
        principals[8],
        principals[9],
        principals[10],
      ],
    });
    const audit = await send("GET", `${base}/x/audit`, a.session);
    const { events } = (await audit.json()) as { events: AuditEvent[] };
    const created = events.at(-1);
    expect(created).toMatchObject({ type: "ob.grant.created", payload: { grant } });
    const feed = await send("GET", `${base}/events?after=0`, a.session);
    expect(feed.status).toBe(200);
    expect(await feed.text()).not.toContain("ob.grant.created");
  } finally {
    await app.close();
  }
});

const everyone = [{ kind: "everyone" }];
test.each([
  { principals: everyone, can: { "*": "all" }, extra: true },
  { principals: [{ kind: "everyone", extra: true }], can: { "*": "all" } },
  { principals: everyone, can: { "dev//": "all" } },
  { principals: [{ kind: "project", project: "example", environments: ["production"] }], can: { "*": "all" } },
  { principals: [{ kind: "project", project: "prj_example" }], can: { "*": "all" } },
  { principals: [{ kind: "all-projects", environments: ["custom"] }], can: { "*": "all" } },
  { principals: [{ kind: "github", repository: "example/web", branch: "refs/heads/" }], can: { "*": "all" } },
  { principals: [{ kind: "user", email: "ada@example.com" }], can: { "*": "all" } },
  { principals: [{ kind: "oidc", issuer: "https://issuer.example", claims: {} }], can: { "*": "all" } },
  { principals: [{ kind: "oidc", issuer: "https://issuer.example", claims: { sub: "abc*" } }], can: { "*": "all" } },
])("POST /grants refuses malformed input %#", async (input) => {
  const app = makeApp();
  try {
    const response = await call(app, "POST", "/grants", input);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_grant" } });
  } finally {
    await app.close();
  }
});

test("POST /grants checks manage at every pattern and applies new grants on the next request", async () => {
  const app = makeApp();
  try {
    const direct = await call(app, "POST", "/x/connections", { name: "dev", can: { "dev/": "all" }, direct: true });
    const { connection, secret } = (await direct.json()) as OutputOf<typeof createConnection>;
    const send = (path: string, body: unknown) =>
      app.fetch(
        new Request(BOARD_URL + path, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const principals = [{ kind: "connection", connection: connection.id }];
    const refused = await send("/grants", { principals, can: { "dev/": ["read"], ops: ["post"] } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "forbidden" } });
    const oidc = [{ kind: "oidc", issuer: "https://issuer.example", claims: { sub: "example" } }];
    expect((await send("/grants", { principals: oidc, can: { "dev/": ["read"] } })).status).toBe(403);
    expect((await send("/grants", { principals, can: { "dev/": ["read"] } })).status).toBe(200);
    expect((await send("/messages", { channel: "ops", text: "hi" })).status).toBe(403);
    expect((await call(app, "POST", "/grants", { principals, can: { "deploys/": ["read", "post"] } })).status).toBe(
      200,
    );
    expect((await send("/messages", { channel: "deploys/web", text: "hi" })).status).toBe(201);
    expect((await send("/messages", { channel: "ops", text: "hi" })).status).toBe(403);
  } finally {
    await app.close();
  }
});

test("a GitHub grant matches the linked identity on the next session and personal token requests", async () => {
  const { app, a, send } = await seed();
  const base = "/api/alpha/main";
  try {
    const post = (credential: typeof a.session) =>
      send("POST", `${base}/messages`, credential, { channel: "restricted", text: "hi" });
    expect((await post(a.session)).status).toBe(201);
    // A specific grant takes precedence over the implicit all-users wildcard.
    const grant = await send("POST", `${base}/grants`, a.session, {
      principals: [{ kind: "github", repository: "a" }],
      can: { restricted: ["read"] },
    });
    expect(grant.status).toBe(200);
    expect((await post(a.session)).status).toBe(403);
    expect((await post(a.personal)).status).toBe(403);
  } finally {
    await app.close();
  }
});

test("an all-connections grant applies to a direct secret and stays outside an existing agent pin", async () => {
  const app = makeApp();
  try {
    const direct = await call(app, "POST", "/x/connections", { name: "fleet", can: { "*": ["read"] }, direct: true });
    const { secret } = (await direct.json()) as OutputOf<typeof createConnection>;
    function send(token: string, path: string, body: unknown) {
      return app.fetch(
        new Request(BOARD_URL + path, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    }
    const claim = await send(secret, "/x/connections/claim", { profile: "fixer" });
    expect(claim.status).toBe(200);
    const original = (await claim.json()) as { token: string };
    const grant = await call(app, "POST", "/grants", {
      principals: [{ kind: "all-connections" }],
      can: { dev: ["post"] },
    });
    expect(grant.status).toBe(200);
    const post = { channel: "dev", text: "hi" };
    expect((await send(secret, "/messages", post)).status).toBe(201);
    expect((await send(original.token, "/messages", post)).status).toBe(403);
    const reissued = await send(secret, "/x/connections/claim", { profile: "fixer-two" });
    const updated = (await reissued.json()) as { token: string };
    expect((await send(updated.token, "/messages", post)).status).toBe(201);
  } finally {
    await app.close();
  }
});

test("an agent with manage in its pin cannot create durable grants", async () => {
  const app = makeApp();
  try {
    const connection = await call(app, "POST", "/x/connections", { name: "agent", can: { "*": "all" } });
    const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
    const claim = await app.fetch(
      new Request(`${BOARD_URL}/x/connections/claim`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ profile: "fixer" }),
      }),
    );
    expect(claim.status).toBe(200);
    const { token } = (await claim.json()) as { token: string };
    const response = await app.fetch(
      new Request(`${BOARD_URL}/grants`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ principals: [{ kind: "all-connections" }], can: { "*": "all" } }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  } finally {
    await app.close();
  }
});

test("keeps large OIDC claim documents under a bounded index key", async () => {
  const app = makeApp();
  try {
    const alternatives = Array.from(
      { length: 8 },
      (_, index) =>
        new Bun.CryptoHasher("sha512").update(String(index)).digest("hex") +
        new Bun.CryptoHasher("sha512").update(`other${index}`).digest("hex") +
        new Bun.CryptoHasher("sha512").update(`third${index}`).digest("hex"),
    );
    const principals = [{ kind: "oidc", issuer: "https://issuer.example", claims: { sub: alternatives } }];
    const response = await call(app, "POST", "/grants", { principals, can: { "*": "all" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      grant: { principals: [{ ...principals[0], claims: { sub: alternatives.sort() } }] },
    });
  } finally {
    await app.close();
  }
});
