import { expect, test } from "bun:test";
import type { ClaimResult, CreatedConnection } from "@openboard/contract";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";

type App = ReturnType<typeof makeApp>;

const SECRET = /^obc_[a-z2-7]{16}_[A-Za-z0-9_-]{43}$/;
const MINUTE = 60_000;

function as(app: App, token: string, path: string, method = "GET", body?: object) {
  return app.fetch(
    new Request(BOARD_URL + path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

async function create(app: App, name: string, direct = true): Promise<CreatedConnection> {
  const response = await call(app, "POST", "/x/connections", { name, can: { "*": "all" }, direct });
  expect(response.status).toBe(201);
  return (await response.json()) as CreatedConnection;
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

/** An app whose clock the test moves. */
function clocked() {
  const clock = { now: NOW };
  return { app: makeApp({ now: () => clock.now }), clock };
}

test("a rotated secret's predecessor works for the overlap, then only the new one does", async () => {
  const { app, clock } = clocked();
  try {
    const laptop = await create(app, "laptop");
    const rotated = await call(app, "POST", `/x/connections/${laptop.connection.id}/rotate`, { overlap: "10m" });
    expect(rotated.status).toBe(200);
    const body = (await rotated.json()) as CreatedConnection & { previousUntil: string | null };
    expect(body.secret).toMatch(SECRET);
    expect(body.secret).not.toBe(laptop.secret);
    expect(body.secret.slice(0, 20)).toBe(laptop.secret.slice(0, 20));
    expect(body).toEqual({
      connection: { ...laptop.connection, secretHint: `obc_…${body.secret.slice(-4)}` },
      secret: body.secret,
      env: { BOARD_URL, BOARD_TOKEN: body.secret },
      previousUntil: "2023-11-14T22:23:20.000Z",
    });

    clock.now = NOW + 10 * MINUTE - 1;
    expect((await as(app, laptop.secret, "/me")).status).toBe(200);
    expect((await as(app, body.secret, "/me")).status).toBe(200);
    clock.now = NOW + 10 * MINUTE;
    await expectError(await as(app, laptop.secret, "/me"), 401, "unauthorized");
    expect((await as(app, body.secret, "/me")).status).toBe(200);
  } finally {
    await app.close();
  }
});

test("without an overlap the old secret stops at once, and agent tokens it claimed keep working", async () => {
  const { app, clock } = clocked();
  try {
    const fixers = await create(app, "fixers", false);
    const claimed = await as(app, fixers.secret, "/x/connections/claim", "POST", { profile: "fixer-1" });
    expect(claimed.status).toBe(200);
    const { token } = (await claimed.json()) as ClaimResult;

    const rotated = await call(app, "POST", `/x/connections/${fixers.connection.id}/rotate`);
    expect(rotated.status).toBe(200);
    const body = (await rotated.json()) as CreatedConnection & { previousUntil: string | null };
    expect(body.previousUntil).toBeNull();
    clock.now = NOW + 1;
    const claimAgain = { profile: "fixer-2" };
    await expectError(await as(app, fixers.secret, "/x/connections/claim", "POST", claimAgain), 401, "unauthorized");
    expect((await as(app, body.secret, "/x/connections/claim", "POST", claimAgain)).status).toBe(200);
    expect((await as(app, token, "/me")).status).toBe(200);
  } finally {
    await app.close();
  }
});

test("a second rotation ends the first one's overlap", async () => {
  const { app } = clocked();
  try {
    const laptop = await create(app, "laptop");
    const path = `/x/connections/${laptop.connection.id}/rotate`;
    const first = (await (await call(app, "POST", path, { overlap: "1h" })).json()) as CreatedConnection;
    const second = (await (await call(app, "POST", path, { overlap: "1h" })).json()) as CreatedConnection;
    await expectError(await as(app, laptop.secret, "/me"), 401, "unauthorized");
    expect((await as(app, first.secret, "/me")).status).toBe(200);
    expect((await as(app, second.secret, "/me")).status).toBe(200);
  } finally {
    await app.close();
  }
});

test("rotation refuses an overlap past 24 hours, an unknown or revoked connection, and the connection itself", async () => {
  const { app } = clocked();
  try {
    const laptop = await create(app, "laptop");
    const path = `/x/connections/${laptop.connection.id}/rotate`;
    await expectError(await call(app, "POST", path, { overlap: "25h" }), 400, "invalid_request");
    await expectError(await call(app, "POST", path, { overlap: "10y" }), 400, "invalid_request");
    await expectError(await as(app, laptop.secret, path, "POST", {}), 403, "forbidden");
    await expectError(await call(app, "POST", `/x/connections/cn_${"c".repeat(16)}/rotate`), 404, "not_found");
    expect((await as(app, laptop.secret, "/me")).status).toBe(200);
    expect((await call(app, "POST", `/x/connections/${laptop.connection.id}/revoke`)).status).toBe(200);
    await expectError(await call(app, "POST", path, { overlap: "10m" }), 404, "not_found");
  } finally {
    await app.close();
  }
});
