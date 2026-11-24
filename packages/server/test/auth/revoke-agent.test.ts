import { expect, test } from "bun:test";
import type { ClaimResult, CreatedConnection } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

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

async function claim(app: App, secret: string, profile: string): Promise<ClaimResult> {
  const response = await as(app, secret, "/x/connections/claim", "POST", { profile });
  expect(response.status).toBe(200);
  return (await response.json()) as ClaimResult;
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

test("revoking one agent makes its tokens answer 401 while its connection and sibling agents keep working", async () => {
  const app = makeApp();
  try {
    const fixers = await create(app, "fixers");
    const first = await claim(app, fixers.secret, "first");
    const second = await claim(app, fixers.secret, "second");
    const refresh = await as(app, first.token, "/x/connections/refresh", "POST");
    expect(refresh.status).toBe(200);
    const renewed = ((await refresh.json()) as ClaimResult).token;
    const path = `/x/connections/${fixers.connection.id}/agents/${first.agent.id}/revoke`;
    await expectError(await as(app, second.token, path, "POST"), 403, "forbidden");
    await expectError(await as(app, fixers.secret, path, "POST"), 403, "forbidden");

    const revoked = await call(app, "POST", path);
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({
      id: first.agent.id,
      connection: fixers.connection.id,
      revokedAt: "2023-11-14T22:13:20.000Z",
    });

    for (const token of [first.token, renewed]) {
      await expectError(await as(app, token, "/me"), 401, "unauthorized");
    }
    await expectError(await as(app, renewed, "/x/connections/refresh", "POST"), 401, "unauthorized");
    for (const token of [second.token, fixers.secret]) {
      expect((await as(app, token, "/me")).status).toBe(200);
    }
    expect((await as(app, second.token, "/x/connections/refresh", "POST")).status).toBe(200);
    // The revoked agent no longer holds its profile (D50): the connection's secret claims it again.
    const again = await claim(app, fixers.secret, "first");
    expect(again.agent.id).not.toBe(first.agent.id);
    await expectError(await call(app, "POST", path), 404, "not_found");
  } finally {
    await app.close();
  }
});

test("an agent is revoked only under its own connection, and an unknown agent is not found", async () => {
  const app = makeApp();
  try {
    const fixers = await create(app, "fixers");
    const other = await create(app, "other");
    const agent = await claim(app, fixers.secret, "first");
    const elsewhere = `/x/connections/${other.connection.id}/agents/${agent.agent.id}/revoke`;
    await expectError(await call(app, "POST", elsewhere), 404, "not_found");
    const unknown = `/x/connections/${fixers.connection.id}/agents/ag_${"z".repeat(16)}/revoke`;
    await expectError(await call(app, "POST", unknown), 404, "not_found");
    expect((await as(app, agent.token, "/me")).status).toBe(200);
  } finally {
    await app.close();
  }
});
