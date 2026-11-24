import { expect, test } from "bun:test";
import type { createConnection, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

test("a grant batch checks lockout against the combined grants and rolls back a refused write", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/x/connections", { name: "manager", can: { "*": "all" }, direct: true });
    expect(created.status).toBe(201);
    const { connection, secret } = (await created.json()) as OutputOf<typeof createConnection>;
    const listed = () => call(app, "GET", "/grants").then((response) => response.json());
    const batch = (grants: unknown[], lockMeOut?: boolean) =>
      app.fetch(
        new Request(`${BOARD_URL}/grants/batch`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify({ grants, lockMeOut }),
        }),
      );
    const closure = { principals: [{ kind: "everyone" }], can: { "factory/": [] } };
    const keeper = { principals: [{ kind: "connection", connection: connection.id }], can: { "factory/": "all" } };
    const before = await listed();
    const denied = await batch([closure]);
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ error: { code: "grant_lockout" } });
    const missing = await batch([
      closure,
      { ...keeper, principals: [{ kind: "connection", connection: "cn_aaaaaaaaaaaaaaaa" }] },
    ]);
    expect(missing.status).toBe(404);
    expect(await listed()).toEqual(before);

    const accepted = await batch([closure, keeper]);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      grants: [
        { id: "g5", ...closure },
        { id: "g6", ...keeper },
      ],
    });

    const forced = await batch([{ ...closure, can: { "private/": [] } }], true);
    expect(forced.status).toBe(200);
  } finally {
    await app.close();
  }
});

test("a malformed grant draft and an invalid batch size have distinct errors", async () => {
  const app = makeApp();
  try {
    const malformed = { principals: [{ kind: "everyone" }], can: { "factory/": ["unknown"] } };
    const item = await call(app, "POST", "/grants/batch", { grants: [malformed] });
    expect(item.status).toBe(400);
    expect(await item.json()).toMatchObject({ error: { code: "invalid_grant" } });

    const envelope = await call(app, "POST", "/grants/batch", { grants: Array.from({ length: 17 }, () => malformed) });
    expect(envelope.status).toBe(400);
    expect(await envelope.json()).toMatchObject({ error: { code: "invalid_request" } });
  } finally {
    await app.close();
  }
});
