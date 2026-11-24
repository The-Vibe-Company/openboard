import { expect, test } from "bun:test";
import type { createConnection, listSchemas, OutputOf } from "@openboard/contract";
import { seed } from "../isolation/seed.ts";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

const registration = { name: "sandbox", version: 1, schema: { type: "object" } };

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

test("a connection with only dev read can list and inspect every built-in schema", async () => {
  const app = makeApp();
  try {
    const issued = await call(app, "POST", "/x/connections", {
      name: "reader",
      direct: true,
      can: { dev: ["read"] },
    });
    expect(issued.status).toBe(201);
    const { secret } = (await issued.json()) as OutputOf<typeof createConnection>;
    const get = (path: string) =>
      app.fetch(new Request(`${BOARD_URL}${path}`, { headers: { authorization: `Bearer ${secret}` } }));
    const list = await get("/schemas");
    expect(list.status).toBe(200);
    const { schemas } = (await list.json()) as OutputOf<typeof listSchemas>;
    expect(schemas.map(({ id }) => id)).toEqual(["git-commit@1", "vercel-deployment@1"]);
    for (const schema of schemas) {
      expect(schema).toMatchObject({ builtIn: true, by: null, at: null, schema: { type: "object" } });
      const read = await get(`/schemas/${schema.id}`);
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual({ schema });
    }
  } finally {
    await app.close();
  }
});

test("schema reads distinguish missing IDs and malformed IDs", async () => {
  const app = makeApp();
  try {
    await expectError(await call(app, "GET", "/schemas/conformance-none@1"), 404, "schema_not_found");
    await expectError(await call(app, "GET", "/schemas/Not%20A%20Schema"), 400, "invalid_schema_id");
  } finally {
    await app.close();
  }
});

test("schema registration requires the upstream strict request body", async () => {
  const app = makeApp();
  try {
    const post = (fields: Record<string, unknown>) => call(app, "POST", "/schemas", { ...registration, ...fields });
    for (const fields of [
      { extra: true },
      { version: Number.MAX_SAFE_INTEGER + 1 },
      { description: "NUL\u0000" },
      { description: "\uD800" },
    ]) {
      await expectError(await post(fields), 400, "invalid_request");
    }
    expect((await post({ description: "Deployment 🚀" })).status).toBe(201);
  } finally {
    await app.close();
  }
});

test("schema reads scope connection secrets and sessions to their tenant", async () => {
  const { app, store, a, b, send } = await seed();
  try {
    for (const suffix of ["/schemas", "/schemas/git-commit@1"]) {
      const path = `/api/${a.org}/${a.board}${suffix}`;
      await expectError(await send("GET", path, b.connection), 401, "unauthorized");
      await expectError(await send("GET", path, b.session), 404, "not_found");
    }
  } finally {
    await app.close();
    await store.close();
  }
});
