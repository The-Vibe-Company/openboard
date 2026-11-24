import { expect, test } from "bun:test";
import {
  CAN_HEADER,
  type claimConnection,
  type createConnection,
  type listSchemas,
  type OutputOf,
} from "@openboard/contract";
import { BOARD_URL, call, makeApp, OWNER } from "../support/app.ts";

const registration = { name: "sandbox", version: 1, schema: { type: "object" } };

test("a narrowed owner and a pinned agent can list schemas but cannot register them", async () => {
  const app = makeApp();
  const send = (path: string, headers: Record<string, string>, body?: object) =>
    app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );

  try {
    const created = await call(app, "POST", "/x/connections", {
      name: "runner",
      direct: true,
      can: { "*": "all" },
    });
    expect(created.status).toBe(201);
    const { secret } = (await created.json()) as OutputOf<typeof createConnection>;
    const claim = await send(
      "/x/connections/claim",
      { authorization: `Bearer ${secret}` },
      { profile: "runner", can: { dev: ["read", "post"] } },
    );
    expect(claim.status).toBe(200);
    const { token } = (await claim.json()) as OutputOf<typeof claimConnection>;

    const narrowedCallers: Record<string, string>[] = [
      { authorization: `Bearer ${OWNER.token}`, [CAN_HEADER]: "dev=read,post" },
      { authorization: `Bearer ${token}` },
    ];
    for (const headers of narrowedCallers) {
      const list = await send("/schemas", headers);
      expect(list.status).toBe(200);
      const { schemas } = (await list.json()) as OutputOf<typeof listSchemas>;
      expect(schemas.map(({ id }) => id)).toContain("git-commit@1");

      const refused = await send("/schemas", headers, registration);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({
        error: { code: "forbidden", message: expect.stringContaining("manage") },
      });

      const absent = await call(app, "GET", "/schemas/sandbox@1");
      expect(absent.status).toBe(404);
      expect(await absent.json()).toMatchObject({ error: { code: "schema_not_found" } });
    }

    const registered = await call(app, "POST", "/schemas", registration);
    expect(registered.status).toBe(201);
    expect(await registered.json()).toMatchObject({ created: true, schema: { id: "sandbox@1" } });
  } finally {
    await app.close();
  }
});
