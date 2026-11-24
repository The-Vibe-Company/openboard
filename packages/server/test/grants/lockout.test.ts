import { expect, test } from "bun:test";
import type { CanInput, createConnection, OutputOf } from "@openboard/contract";
import { seed, signIn } from "../isolation/seed.ts";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

const closure = { principals: [{ kind: "everyone" }], can: { "factory/": ["read"] } };

async function manager(app: ReturnType<typeof makeApp>, can: CanInput = { "*": "all" }) {
  const created = await call(app, "POST", "/x/connections", { name: "manager", can, direct: true });
  expect(created.status).toBe(201);
  const { connection, secret } = (await created.json()) as OutputOf<typeof createConnection>;
  const send = (method: string, path: string, body?: unknown) =>
    app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method,
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { id: connection.id, send };
}

async function expectRefused(response: Response, id: string) {
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: {
      code: "grant_lockout",
      hint: "Create the keeping grant first. If you lack permission, ask a board owner to run the command. To make the change anyway, retry with --lock-me-out.",
      next: [{ kind: "run", argv: ["ob", "grants", "create", "--connection", id, "--can", "factory/=all"] }],
    },
  });
}

test("refuses an everyone closure with recovery guidance and rolls back the grant", async () => {
  const app = makeApp();
  try {
    const { id, send } = await manager(app);
    const listed = () => send("GET", "/grants").then((response) => response.json());
    const before = await listed();
    await expectRefused(await send("POST", "/grants", closure), id);
    expect(await listed()).toEqual(before);
    const keep = await send("POST", "/grants", {
      principals: [{ kind: "connection", connection: id }],
      can: { "factory/": "all" },
    });
    expect(keep.status).toBe(200);
    expect(await keep.json()).toMatchObject({ grant: { id: "g5" } });
    expect((await send("POST", "/grants", closure)).status).toBe(200);

    const withKeeper = await listed();
    await expectRefused(await send("PATCH", "/grants/g5", { can: { "factory/": ["read"] } }), id);
    await expectRefused(await send("PATCH", "/grants/g5", { can: { "*": "all" } }), id);
    await expectRefused(await send("POST", "/grants/g5/revoke"), id);
    expect(await listed()).toEqual(withKeeper);
    expect((await send("POST", "/grants/g5/revoke", { lockMeOut: true })).status).toBe(200);
  } finally {
    await app.close();
  }
});

test("lockMeOut allows creating the closure without a keeping grant", async () => {
  const app = makeApp();
  try {
    const { send } = await manager(app);
    expect((await send("POST", "/grants", { ...closure, lockMeOut: true })).status).toBe(200);
  } finally {
    await app.close();
  }
});

test("the local owner can create, narrow and revoke a grant even when it closes a channel", async () => {
  const app = makeApp();
  try {
    expect((await call(app, "POST", "/grants", closure)).status).toBe(200);
    expect((await call(app, "PATCH", "/grants/g4", { can: { "factory/": [] } })).status).toBe(200);
    expect((await call(app, "POST", "/grants/g4/revoke")).status).toBe(200);
  } finally {
    await app.close();
  }
});

test("organization owners and admins can create a closure without lockMeOut", async () => {
  const { app, store, a, send } = await seed();
  try {
    const admin = await signIn(store, "admin", "f");
    const invite = await send("POST", "/api/x/orgs/alpha/invitations", a.session, { role: "admin" });
    expect(invite.status).toBe(201);
    const { url } = (await invite.json()) as { url: string };
    const accept = await send("POST", "/api/x/invitations/accept", admin.headers, {
      token: new URL(url).pathname.split("/").at(-1),
    });
    expect(accept.status).toBe(200);
    const path = "/api/alpha/main/grants";
    expect((await send("POST", path, a.session, closure)).status).toBe(200);
    expect(
      (
        await send("POST", path, admin.headers, {
          ...closure,
          can: { "admin-factory/": [] },
        })
      ).status,
    ).toBe(200);
  } finally {
    await app.close();
    await store.close();
  }
});

test("a board owner can make the keeping grant for a manager without board-wide everyone permissions", async () => {
  const app = makeApp();
  try {
    const { id, send } = await manager(app, { "factory/": "all" });
    const everyone = { ...closure, can: { "public/": ["read"], "factory/": ["read"] } };
    expect((await call(app, "POST", "/grants", everyone)).status).toBe(200);
    const keepingGrant = { principals: [{ kind: "connection", connection: id }], can: { "factory/": "all" } };
    await expectRefused(await send("POST", "/grants/g4/revoke"), id);
    expect((await send("POST", "/grants", keepingGrant)).status).toBe(403);
    expect((await call(app, "POST", "/grants", keepingGrant)).status).toBe(200);
    expect((await send("POST", "/grants/g4/revoke")).status).toBe(200);
  } finally {
    await app.close();
  }
});
