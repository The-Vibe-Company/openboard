import { expect, test } from "bun:test";
import {
  CAN_HEADER,
  type claimConnection,
  type createConnection,
  createWebhook,
  listWebhooks,
  type OutputOf,
  operations,
} from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

const webhook = {
  name: "dev-events",
  url: "http://127.0.0.1:9000/hook",
  filter: { tail: "dev" },
};

function fetchAs(app: ReturnType<typeof makeApp>, token: string, method: string, path: string, body?: object) {
  return app.fetch(
    new Request(`${BOARD_URL}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("a claimed token cannot configure webhooks or inbound endpoints", async () => {
  const app = makeApp({ secretKey: new Uint8Array(32).fill(12) });
  try {
    const connection = await call(app, "POST", "/x/connections", { name: "sandbox", can: { "*": "all" } });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
    const claim = await fetchAs(app, secret, "POST", "/x/connections/claim", { profile: "builder" });
    expect(claim.status).toBe(200);
    const { token } = (await claim.json()) as OutputOf<typeof claimConnection>;
    expect(token.startsWith("obt_")).toBe(true);

    const created = await call(app, "POST", createWebhook.route.path, { ...webhook, name: "existing-hook" });
    expect(created.status).toBe(201);
    const { webhook: existing } = (await created.json()) as OutputOf<typeof createWebhook>;

    const configuration = operations.filter(
      ({ route: { method, path } }) =>
        (path.startsWith("/x/webhooks") || path.startsWith("/x/inbound")) &&
        !(method === "POST" && path === "/x/inbound/:id/events"),
    );
    expect(configuration.length).toBeGreaterThan(0);
    for (const {
      name,
      route: { method, path },
    } of configuration) {
      const url = path.replace(/:[^/]+/g, existing.id);
      const body = name === createWebhook.name ? webhook : undefined;
      const response = await fetchAs(app, token, method, url, body);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json(), `${method} ${path}`).toMatchObject({ error: { code: "forbidden" } });
    }

    const listed = await call(app, "GET", listWebhooks.route.path);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ webhooks: [existing] });
  } finally {
    await app.close();
  }
});

test("a direct connection narrowed to read and post cannot create a dev webhook", async () => {
  const app = makeApp({ secretKey: new Uint8Array(32).fill(12) });
  try {
    const connection = await call(app, "POST", "/x/connections", {
      name: "direct",
      direct: true,
      can: { "*": "all" },
    });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
    const response = await app.fetch(
      new Request(`${BOARD_URL}${createWebhook.route.path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          [CAN_HEADER]: "dev=read,post",
        },
        body: JSON.stringify(webhook),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "forbidden", message: expect.stringContaining("manage") },
    });

    const listed = await call(app, "GET", listWebhooks.route.path);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ webhooks: [] });
  } finally {
    await app.close();
  }
});
