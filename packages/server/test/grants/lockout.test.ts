import { expect, test } from "bun:test";
import type { createConnection, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

test("creating a grant that strips the maker's manage rolls back unless lockMeOut is set", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/x/connections", {
      name: "manager",
      can: { "*": "all" },
      direct: true,
    });
    expect(created.status).toBe(201);
    const { secret } = (await created.json()) as OutputOf<typeof createConnection>;
    const grant = { principals: [{ kind: "everyone" }], can: { "ops/": ["read"] } };
    const create = (lockMeOut?: boolean) =>
      app.fetch(
        new Request(`${BOARD_URL}/grants`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify({ ...grant, lockMeOut }),
        }),
      );
    const listed = () => call(app, "GET", "/grants").then((response) => response.json());

    const before = await listed();
    const refused = await create();
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "grant_lockout" } });
    expect(await listed()).toEqual(before);

    const accepted = await create(true);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ grant: { id: "g5", can: grant.can } });
  } finally {
    await app.close();
  }
});
