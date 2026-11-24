import { expect, test } from "bun:test";
import type { createConnection, createInvitation, createSchema, listSchemas, OutputOf } from "@openboard/contract";
import type { SchemaRegistered } from "@openboard/core";
import { testScope } from "@openboard/ports/testkit";
import { call, LOCAL_OWNER, makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";
import { openStore } from "../support/drivers.ts";

const registration = {
  name: "sandbox",
  version: 1,
  description: "What a sandbox did.",
  schema: { type: "object", properties: { id: { type: "string" } } },
};

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

test("concurrent registration folds once, preserves metadata, and appears only in the audit", async () => {
  const app = makeApp();
  try {
    const write = (input: object) => call(app, "POST", "/schemas", input);
    const pair = await Promise.all([
      write(registration),
      write({ ...registration, schema: { properties: registration.schema.properties, type: "object" } }),
    ]);
    expect(pair.map(({ status }) => status).sort()).toEqual([200, 201]);
    const entries = (await Promise.all(pair.map((response) => response.json()))) as OutputOf<typeof createSchema>[];
    const created = entries.find((entry) => entry.created)!;
    expect(created.schema).toMatchObject({ id: "sandbox@1", by: "ob:user:local-test", at: "2023-11-14T22:13:20.000Z" });
    expect(entries.find((entry) => !entry.created)?.schema).toEqual(created.schema);
    await expectError(await write({ ...registration, description: "Changed." }), 409, "schema_immutable");
    await expectError(
      await write({ ...registration, schema: { type: "object", required: ["id"] } }),
      409,
      "schema_immutable",
    );
    const read = await call(app, "GET", "/schemas/sandbox@1");
    expect(await read.json()).toEqual({ schema: created.schema });
    const list = await call(app, "GET", "/schemas");
    const { schemas } = (await list.json()) as OutputOf<typeof listSchemas>;
    expect(schemas.map(({ id }) => id)).toEqual(["git-commit@1", "vercel-deployment@1", "sandbox@1"]);
    const audit = await call(app, "GET", "/x/audit");
    expect(await audit.json()).toMatchObject({
      events: [{ type: "ob.schema.registered", payload: { id: "sandbox@1" } }],
    });
    const events = await call(app, "GET", "/events");
    expect(await events.json()).toMatchObject({ events: [] });
  } finally {
    await app.close();
  }
});

test("strict registration checks body keys, root type and description length", async () => {
  const app = makeApp();
  try {
    await expectError(await call(app, "POST", "/schemas", { ...registration, extra: true }), 400, "invalid_request");
    await expectError(
      await call(app, "POST", "/schemas", { ...registration, schema: { type: "string" } }),
      400,
      "invalid_schema",
    );
    const description = "🚀".repeat(1_000);
    const post = (description: string) => call(app, "POST", "/schemas", { ...registration, description });
    await expectError(await post(`${description}a`), 400, "invalid_request");
    expect((await post(description)).status).toBe(201);
  } finally {
    await app.close();
  }
});

test("a board holds 500 custom versions and still accepts an identical repeat", async () => {
  const store = openStore(() => NOW);
  const app = makeApp({ store });
  try {
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing local board");
    const board = store.board(testScope(keys));
    await board.write((writer) =>
      writer.append(
        Array.from(
          { length: 499 },
          (_, index): SchemaRegistered => ({
            id: writer.head + index + 1,
            type: "ob.schema.registered",
            visibility: 2,
            at: NOW,
            actor: LOCAL_OWNER,
            principal: LOCAL_OWNER,
            channel: null,
            thread: null,
            message: null,
            payload: {
              id: `seed@${index + 1}`,
              name: "seed",
              version: index + 1,
              definition: '{"type":"object"}',
              description: null,
            },
          }),
        ),
      ),
    );
    expect((await call(app, "POST", "/schemas", registration)).status).toBe(201);
    await expectError(await call(app, "POST", "/schemas", { ...registration, version: 2 }), 400, "too_many_schemas");
    expect((await call(app, "POST", "/schemas", registration)).status).toBe(200);
  } finally {
    await app.close();
  }
});

test("registration requires board-wide manage and stays on the registering board", async () => {
  const app = makeBrowserApp();
  const board = "/api/acme/main";
  const send = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    app.fetch(new Request(`${PUBLIC_URL}${path}`, { method, headers, body: JSON.stringify(body) }));
  try {
    const { headers: owner } = await browserSession(app.fetch, "ada");
    const { headers: member } = await browserSession(app.fetch, "lin");
    expect((await send("POST", "/api/x/orgs", owner, { slug: "acme", name: "Acme" })).status).toBe(201);
    const invitation = await send("POST", "/api/x/orgs/acme/invitations", owner, { role: "member" });
    expect(invitation.status).toBe(201);
    const { url } = (await invitation.json()) as OutputOf<typeof createInvitation>;
    const token = new URL(url).pathname.slice("/invite/".length);
    const accepted = await send("POST", "/api/x/invitations/accept", member, { token });
    expect(accepted.status).toBe(200);
    await expectError(await send("POST", `${board}/schemas`, member, registration), 403, "forbidden");

    const connection = await send("POST", `${board}/x/connections`, owner, {
      name: "channel-manager",
      can: { dev: ["manage"] },
      direct: true,
    });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
    await expectError(
      await send("POST", `${board}/schemas`, { authorization: `Bearer ${secret}` }, registration),
      403,
      "forbidden",
    );

    expect((await send("POST", `${board}/schemas`, owner, registration)).status).toBe(201);
    expect((await send("POST", "/api/x/orgs/acme/boards", owner, { slug: "other", name: "Other" })).status).toBe(201);
    const other = "/api/acme/other/schemas";
    await expectError(await send("GET", `${other}/sandbox@1`, owner), 404, "schema_not_found");
    const list = await send("GET", other, owner);
    expect(list.status).toBe(200);
    const { schemas } = (await list.json()) as OutputOf<typeof listSchemas>;
    expect(schemas.map(({ id }) => id)).toEqual(["git-commit@1", "vercel-deployment@1"]);
  } finally {
    await app.close();
  }
});
