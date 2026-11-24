import { expect, test } from "bun:test";
import {
  type claimConnection,
  type createConnection,
  type getConnectionPolicy,
  type Operation,
  type OutputOf,
  operations,
} from "@openboard/contract";
import { refuseClaimedConfiguration } from "../../src/auth/tokens.ts";
import { BOARD_URL, call, makeApp, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";

const pins = "?profile=fixer-2&can=work/fix/=read,post";
const direct = { name: "fixers", direct: true, profiles: ["fixer-*"], can: { "work/fix/": ["read", "post"] } };

async function expectError(response: Response, status: number, code: string, message?: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code, ...(message === undefined ? {} : { message }) } });
}

async function issued(response: Response) {
  expect(response.status).toBe(201);
  return (await response.json()) as OutputOf<typeof createConnection>;
}

test("a direct connection policy injects pinned headers and lists only gateway routes", async () => {
  const app = makeApp();
  try {
    const { connection, secret } = await issued(await call(app, "POST", "/x/connections", direct));
    const response = await call(app, "GET", `/x/connections/${connection.id}/policy${pins}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(secret);
    const policy = JSON.parse(text) as OutputOf<typeof getConnectionPolicy>;
    expect(policy.env).toEqual({ BOARD_URL, BOARD_TOKEN: "<placeholder>", BOARD_PROFILE: "fixer-2" });
    expect(policy.headers).toEqual({
      authorization: `Bearer \${OPENBOARD_SECRET}`,
      "x-board-profile": "fixer-2",
      "x-board-can": "work/fix/=read,post",
    });
    expect(policy.routes).toContainEqual({ method: "POST", path: "/mcp/local/main" });
    const boardPath = "/api/local/main";
    expect(policy.routes).toContainEqual({ method: "POST", path: `${boardPath}/messages` });
    expect(policy.routes).toContainEqual({ method: "GET", path: `${boardPath}/schemas/:id` });
    const probe = new Request(BOARD_URL, { headers: { authorization: "Bearer obt_" } });
    for (const { method, path } of policy.routes) {
      if (path === "/mcp/local/main" && method === "POST") continue;
      expect(path === boardPath || path.startsWith(`${boardPath}/`)).toBe(true);
      const relative = path.slice(boardPath.length) || "/";
      expect(relative).not.toMatch(/^\/(?:grants|watchers|sync|inbox|x|webhooks|wake)(?:\/|$)/);
      expect({ method, path: relative }).not.toEqual({ method: "POST", path: "/schemas" });
      const operation = (operations as readonly Operation[]).find(
        (op) =>
          (op.scope === "board" || op.scope === "public") &&
          !op.route.mount &&
          op.route.method === method &&
          op.route.path === relative,
      );
      if (!operation) throw new Error(`policy route ${method} ${path} is missing from the contract`);
      expect(() => refuseClaimedConfiguration(probe, operation)).not.toThrow();
    }
  } finally {
    await app.close();
  }
});

test("a policy rejects disallowed profiles, wider scopes, and non-direct connections", async () => {
  const app = makeApp();
  try {
    const { connection } = await issued(await call(app, "POST", "/x/connections", direct));
    const path = `/x/connections/${connection.id}/policy`;
    await expectError(await call(app, "GET", path + pins.replace("fixer-2", "other")), 400, "invalid_request");
    await expectError(await call(app, "GET", path + pins.replace("work/fix/", "work/")), 400, "invalid_request");
    const fleet = await issued(await call(app, "POST", "/x/connections", { ...direct, name: "fleet", direct: false }));
    await expectError(
      await call(app, "GET", `/x/connections/${fleet.connection.id}/policy${pins}`),
      400,
      "invalid_request",
      "a proxy injects a direct connection's secret; claim a token instead",
    );
  } finally {
    await app.close();
  }
});

test("policy checks board authority and preserves tenant isolation", async () => {
  const app = makeBrowserApp();
  try {
    const { headers: owner } = await browserSession(app.fetch, "ada");
    const { headers: outsider } = await browserSession(app.fetch, "lin");
    const send = (method: string, path: string, headers: Record<string, string>, body?: object) =>
      app.fetch(
        new Request(PUBLIC_URL + path, {
          method,
          headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    expect((await send("POST", "/api/x/orgs", owner, { slug: "acme", name: "Acme" })).status).toBe(201);
    expect((await send("POST", "/api/x/orgs", outsider, { slug: "other", name: "Other" })).status).toBe(201);
    expect((await send("POST", "/api/x/orgs/acme/boards", owner, { slug: "ops", name: "Ops" })).status).toBe(201);
    const { connection, secret } = await issued(
      await send("POST", "/api/acme/main/x/connections", owner, {
        ...direct,
        can: { "*": "all" },
      }),
    );
    const path = `/x/connections/${connection.id}/policy${pins}`;
    expect((await send("GET", `/api/acme/main${path}`, owner)).status).toBe(200);
    const headers = { authorization: `Bearer ${secret}` };
    await expectError(await send("GET", `/api/acme/main${path}`, headers), 403, "forbidden");
    await expectError(await send("GET", `/api/acme/main${path}`, outsider), 404, "not_found");
    const claimed = await send("POST", "/api/acme/main/x/connections/claim", headers, { profile: "fixer-2" });
    expect(claimed.status).toBe(200);
    const { token } = (await claimed.json()) as OutputOf<typeof claimConnection>;
    const agent = { authorization: `Bearer ${token}` };
    await expectError(await send("GET", `/api/acme/main${path}`, agent), 403, "forbidden");
    await expectError(await send("GET", `/api/acme/ops${path}`, agent), 401, "unauthorized");
  } finally {
    await app.close();
  }
});
