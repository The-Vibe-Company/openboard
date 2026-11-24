import { expect, test } from "bun:test";
import type { CanInput, createConnection, listGrants, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp } from "./support/app.ts";

async function direct(app: ReturnType<typeof makeApp>, name: string, can: CanInput) {
  const response = await call(app, "POST", "/x/connections", { name, can, direct: true, profiles: ["bot"] });
  expect(response.status).toBe(201);
  const { connection, secret } = (await response.json()) as OutputOf<typeof createConnection>;
  return {
    connection,
    send: (method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
      app.fetch(
        new Request(`${BOARD_URL}${path}`, {
          method,
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
      ),
  };
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

test("private creation writes two grants once and admits the connection behind the creator's profile", async () => {
  const app = makeApp();
  try {
    const manager = await direct(app, "manager", { "*": "all" });
    const other = await direct(app, "other", { "*": ["read", "post"] });
    const path = "ops/secret";
    const body = { path, private: true };

    const created = await manager.send("POST", "/channels", body, { "x-board-profile": "bot" });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ created: true, channel: { path } });
    const { grants } = (await (await manager.send("GET", "/grants")).json()) as OutputOf<typeof listGrants>;
    expect(grants.slice(-2)).toMatchObject([
      { principals: [{ kind: "everyone" }], can: { [path]: [] } },
      { principals: [{ kind: "connection", connection: manager.connection.id }], can: { [path]: "all" } },
    ]);

    expect(await (await manager.send("POST", "/channels", body)).json()).toMatchObject({ created: false });
    expect(await (await manager.send("GET", "/grants")).json()).toEqual({ grants });
    expect((await manager.send("POST", "/messages", { channel: path, text: "private" })).status).toBe(201);
    expect((await manager.send("GET", `/messages?channel=${path}`)).status).toBe(200);
    await expectError(await other.send("GET", `/messages?channel=${path}`), 403, "forbidden");
    await expectError(await other.send("POST", "/messages", { channel: path, text: "private" }), 403, "forbidden");
    expect((await other.send("POST", "/messages", { channel: `${path}/child`, text: "public" })).status).toBe(201);
  } finally {
    await app.close();
  }
});

test("private creation requires manage at the exact path and in the request scope", async () => {
  const app = makeApp();
  try {
    const other = await direct(app, "other", { "*": ["read", "post"], "elsewhere/": "all" });
    const body = { path: "ops/refused", private: true };
    const manager = await direct(app, "manager", { "*": "all" });
    const beforeGrants = await (await call(app, "GET", "/grants")).json();
    const beforeChannels = await (await call(app, "GET", "/channels")).json();
    await expectError(await other.send("POST", "/channels", body), 403, "forbidden");
    await expectError(
      await manager.send("POST", "/channels", body, { "x-board-can": "*=read,post" }),
      403,
      "forbidden",
    );
    expect(await (await call(app, "GET", "/channels")).json()).toEqual(beforeChannels);
    expect(await (await call(app, "GET", "/grants")).json()).toEqual(beforeGrants);
  } finally {
    await app.close();
  }
});

test("private creation leaves an existing channel alone and refuses an exact grant conflict", async () => {
  const app = makeApp();
  try {
    const path = "ops/secret";
    await direct(app, "other", { [path]: ["read"] });
    const before = await (await call(app, "GET", "/channels")).json();
    await expectError(await call(app, "POST", "/channels", { path, private: true }), 409, "channel_granted");
    expect(await (await call(app, "GET", "/channels")).json()).toEqual(before);
    expect((await call(app, "POST", "/channels", { path })).status).toBe(201);
    expect(await (await call(app, "POST", "/channels", { path, private: true })).json()).toMatchObject({
      created: false,
    });
    expect((await call(app, "POST", "/channels", { path: "ops/owner", private: true })).status).toBe(201);
    expect(await (await call(app, "GET", "/grants")).json()).toMatchObject({
      grants: expect.arrayContaining([
        {
          id: expect.any(String),
          by: LOCAL_OWNER,
          at: expect.any(String),
          capped: false,
          principals: [{ kind: "user", userId: LOCAL_OWNER.slice("ob:user:".length), email: null }],
          can: { "ops/owner": "all" },
        },
      ]),
    });
  } finally {
    await app.close();
  }
});

test("a connection can create a private channel using its own exact manage grant", async () => {
  const app = makeApp();
  try {
    const path = "ops/secret";
    const manager = await direct(app, "manager", { [path]: "all" });
    const other = await direct(app, "other", { "ops/": ["read", "post"] });
    expect((await manager.send("POST", "/channels", { path, private: true })).status).toBe(201);
    expect((await manager.send("POST", "/messages", { channel: path, text: "private" })).status).toBe(201);
    await expectError(await other.send("GET", `/messages?channel=${path}`), 403, "forbidden");
  } finally {
    await app.close();
  }
});
