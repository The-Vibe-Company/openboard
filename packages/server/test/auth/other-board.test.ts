import { expect, test } from "bun:test";
import type { createConnection, OutputOf } from "@openboard/contract";
import { PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";

test("a direct connection secret cannot read or post on another board in its organization", async () => {
  const app = makeBrowserApp();
  try {
    const { headers: owner } = await browserSession(app.fetch, "ada");
    const send = (method: string, path: string, headers: Record<string, string>, body?: object) =>
      app.fetch(
        new Request(`${PUBLIC_URL}${path}`, {
          method,
          headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        }),
      );
    expect((await send("POST", "/api/x/orgs", owner, { slug: "acme", name: "Acme" })).status).toBe(201);
    expect((await send("POST", "/api/x/orgs/acme/boards", owner, { slug: "ops", name: "Ops" })).status).toBe(201);
    const issued = await send("POST", "/api/acme/main/x/connections", owner, {
      name: "laptop",
      can: { "dev/": ["read", "post"] },
      direct: true,
    });
    expect(issued.status).toBe(201);
    const { secret } = (await issued.json()) as OutputOf<typeof createConnection>;
    const laptop = { authorization: `Bearer ${secret}` };
    const ownBoard = await send("GET", "/api/acme/main/me", laptop);
    expect(ownBoard.status).toBe(200);
    expect(await ownBoard.json()).toMatchObject({ handle: "laptop" });

    for (const [method, path, body] of [
      ["GET", "/api/acme/ops/me"],
      ["POST", "/api/acme/ops/messages", { channel: "dev", text: "must not be written" }],
    ] as const) {
      const response = await send(method, path, laptop, body);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
      process.stdout.write(`${method} ${path} -> ${response.status} unauthorized\n`);
    }

    const messages = await send("GET", "/api/acme/ops/messages?channel=dev", owner);
    expect(messages.status).toBe(200);
    expect(await messages.json()).toMatchObject({ messages: [] });
    process.stdout.write("GET /api/acme/ops/messages?channel=dev as owner -> 200, messages: []\n");
  } finally {
    await app.close();
  }
});
