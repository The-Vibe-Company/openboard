import { expect, test } from "bun:test";
import type { ClaimResult, CreatedConnection } from "@openboard/contract";
import { BOARD_URL, call, makeApp, OWNER, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";

type App = ReturnType<typeof makeApp>;

function as(app: App, token: string, path: string, method = "GET", body?: object) {
  return app.fetch(
    new Request(BOARD_URL + path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

async function create(app: App, name: string): Promise<CreatedConnection> {
  const response = await call(app, "POST", "/x/connections", { name, can: { "*": "all" }, direct: true });
  expect(response.status).toBe(201);
  return (await response.json()) as CreatedConnection;
}

async function claim(app: App, secret: string, profile: string): Promise<string> {
  const response = await as(app, secret, "/x/connections/claim", "POST", { profile });
  expect(response.status).toBe(200);
  return ((await response.json()) as ClaimResult).token;
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

test("revoking a connection invalidates its secret and all agent credentials on the next request", async () => {
  const app = makeApp();
  try {
    const target = await create(app, "fixers");
    const other = await create(app, "other");
    const first = await claim(app, target.secret, "first");
    const second = await claim(app, target.secret, "second");
    const refresh = await as(app, first, "/x/connections/refresh", "POST");
    expect(refresh.status).toBe(200);
    const renewed = ((await refresh.json()) as ClaimResult).token;
    const path = `/x/connections/${target.connection.id}/revoke`;
    await expectError(await as(app, target.secret, path, "POST"), 403, "forbidden");
    for (const token of [target.secret, first, renewed, second]) {
      expect((await as(app, token, "/me")).status).toBe(200);
    }

    const revoked = await call(app, "POST", path);
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ id: target.connection.id, revokedAt: "2023-11-14T22:13:20.000Z" });

    for (const token of [target.secret, first, renewed, second]) {
      await expectError(await as(app, token, "/me"), 401, "unauthorized");
    }
    await expectError(
      await as(app, target.secret, "/x/connections/claim", "POST", { profile: "third" }),
      401,
      "unauthorized",
    );
    await expectError(await as(app, renewed, "/x/connections/refresh", "POST"), 401, "unauthorized");
    expect((await as(app, other.secret, "/me")).status).toBe(200);
    await expectError(await call(app, "POST", path), 404, "not_found");
  } finally {
    await app.close();
  }
});

test("a signed-in organization owner can revoke a connection with CSRF proof", async () => {
  const app = makeBrowserApp(OWNER.hash);
  try {
    const ada = await browserSession(app.fetch, "ada");
    const org = await app.fetch(
      new Request(`${PUBLIC_URL}/api/x/orgs`, {
        method: "POST",
        headers: ada.headers,
        body: JSON.stringify({ name: "Acme", slug: "acme" }),
      }),
    );
    expect(org.status).toBe(201);

    const boardUrl = `${PUBLIC_URL}/api/acme/main`;
    const created = await app.fetch(
      new Request(`${boardUrl}/x/connections`, {
        method: "POST",
        headers: { authorization: `Bearer ${OWNER.token}` },
        body: JSON.stringify({ name: "test", can: { "*": "all" } }),
      }),
    );
    expect(created.status).toBe(201);
    const { connection } = (await created.json()) as CreatedConnection;
    const path = `${boardUrl}/x/connections/${connection.id}/revoke`;
    const revoke = (headers: Record<string, string>) => app.fetch(new Request(path, { method: "POST", headers }));
    await expectError(await revoke({ authorization: `Bearer ${OWNER.token}` }), 401, "unauthorized");
    await expectError(await revoke({ cookie: ada.headers.cookie }), 403, "forbidden");
    const outsider = await browserSession(app.fetch, "lin");
    await expectError(await revoke(outsider.headers), 404, "not_found");
    expect((await revoke(ada.headers)).status).toBe(200);
  } finally {
    await app.close();
  }
});
