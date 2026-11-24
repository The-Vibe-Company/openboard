import { expect, test } from "bun:test";
import type { createConnection, listSchemas, OutputOf } from "@openboard/contract";
import { testScope } from "@openboard/ports/testkit";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, NOW } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const builtIn = { name: "git-commit", version: 2, schema: { type: "object" } };

test("refused definitions and versions of built-ins do not register or emit audit entries", async () => {
  const app = makeApp();
  try {
    const write = (input: object) => call(app, "POST", "/schemas", input);
    for (const input of [
      builtIn,
      { ...builtIn, version: 1, schema: { type: "string" } },
      { ...builtIn, name: "vercel-deployment", schema: { type: "object", $ref: "#" } },
    ]) {
      const response = await write(input);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "reserved_schema" } });
    }

    for (const [schema, path] of [
      [{ type: "string" }, "/type"],
      [{ type: "object", properties: { next: { $ref: "#" } } }, "/properties/next/$ref"],
      [{ type: "object", properties: { id: { type: "string", pattern: "^(a+)+$" } } }, "/properties/id/pattern"],
      [{ type: "object", properties: { ids: { type: "array", uniqueItems: true } } }, "/properties/ids/uniqueItems"],
    ] as const) {
      const response = await write({ name: "refused", version: 1, schema });
      expect(response.status).toBe(400);
      const { error } = (await response.json()) as { error: { code: string; message: string } };
      expect(error.code).toBe("invalid_schema");
      expect(error.message).toContain(path);
    }

    const depth = 20_000;
    const deep = `{"name":"refused","version":1,"schema":{"type":"object","const":${"[".repeat(depth)}null${"]".repeat(depth)}}}`;
    const overDepth = await call(app, "POST", "/schemas", deep);
    expect(overDepth.status).toBe(400);
    expect(await overDepth.json()).toMatchObject({
      error: { code: "invalid_schema", message: expect.stringContaining("16 levels") },
    });

    const response = await call(app, "GET", "/schemas");
    const { schemas } = (await response.json()) as OutputOf<typeof listSchemas>;
    expect(schemas.map(({ id }) => id)).toEqual(["git-commit@1", "vercel-deployment@1"]);
    const audit = await call(app, "GET", "/x/audit");
    expect(await audit.json()).toMatchObject({ events: [] });
  } finally {
    await app.close();
  }
});

test("board-wide manage authorization precedes definition and built-in checks", async () => {
  const app = makeApp();
  try {
    const connection = await call(app, "POST", "/x/connections", {
      name: "channel-manager",
      can: { dev: ["manage"] },
      direct: true,
    });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
    const response = await app.fetch(
      new Request(`${BOARD_URL}/schemas`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ ...builtIn, schema: { type: "string" } }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  } finally {
    await app.close();
  }
});

test("an identical retry of a previously stored custom definition remains a no-op", async () => {
  const store = openStore(() => NOW);
  const app = makeApp({ store });
  try {
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("Missing local board.");
    const board = store.board(testScope(keys));
    await board.write((writer) =>
      writer.append([
        {
          type: "ob.schema.registered",
          visibility: 2,
          id: writer.head + 1,
          at: NOW,
          actor: LOCAL_OWNER,
          principal: LOCAL_OWNER,
          thread: null,
          message: null,
          channel: null,
          payload: {
            id: "legacy@1",
            name: "legacy",
            version: 1,
            description: null,
            definition: '{"properties":{"id":{"pattern":"^a","type":"string"}},"type":"object"}',
          },
        },
      ]),
    );
    const schema = { type: "object", properties: { id: { type: "string", pattern: "^a" } } };
    const retry = await call(app, "POST", "/schemas", { name: "legacy", version: 1, schema });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ created: false, schema: { id: "legacy@1", schema } });
    const changed = await call(app, "POST", "/schemas", {
      name: "legacy",
      version: 1,
      schema,
      description: "Changed.",
    });
    expect(changed.status).toBe(400);
    expect(await changed.json()).toMatchObject({ error: { code: "invalid_schema" } });
    const audit = await call(app, "GET", "/x/audit");
    const { events } = (await audit.json()) as { events: unknown[] };
    expect(events).toHaveLength(1);
  } finally {
    await app.close();
  }
});
