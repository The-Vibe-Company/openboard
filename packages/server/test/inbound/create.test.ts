import { expect, test } from "bun:test";
import type { createConnection, createInbound, OutputOf } from "@openboard/contract";
import { testScope } from "@openboard/ports/testkit";
import {
  INBOUND_VERIFY_INFO,
  openSecret,
  openWebhookSecret,
  sealWebhookSecret,
} from "../../src/webhooks/secret-box.ts";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const key = new Uint8Array(32).fill(12);
const rules = [{ when: { "body.event": "turn.finished" }, do: [{ reply: "Finished: {{body.summary}}" }] }];
const spec = {
  name: "runner-status",
  can: { "work/": ["read", "post", "label"] },
  verify: { preset: "ts-id-body", signatureHeader: "X-Sig", timestampHeader: "X-Time", idHeader: "X-Id" },
  thread: { from: "{{body.externalRef}}", pattern: "^ob:(\\d+)$" },
  rules,
};

test("webhook ciphertext cannot open as an inbound secret with the same endpoint ID", () => {
  const id = "ib_aaaaaaaaaaaaaaaa";
  const credentials = { secret: "verify fixture", headers: {} };
  const sealed = sealWebhookSecret(key, id, credentials, new Uint8Array(12));
  expect(openWebhookSecret(key, id, sealed)).toEqual(credentials);
  expect(openSecret(key, INBOUND_VERIFY_INFO, id, sealed)).toBeNull();
});

test("creates, lists, updates and deletes an endpoint and its exact grant without exposing its secret", async () => {
  const store = openStore(() => NOW);
  const app = makeApp({ secretKey: key, store });
  try {
    const created = await call(app, "POST", "/x/inbound", spec);
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const { inbound, secret } = (await created.json()) as OutputOf<typeof createInbound>;
    expect(inbound.id).toMatch(/^ib_[a-z2-7]{16}$/);
    const path = `/x/inbound/${inbound.id}`;
    expect(inbound).toMatchObject({
      url: `${BOARD_URL}${path}/events`,
      principal: `ob:hook:${inbound.id}`,
      verify: { tolerance: 300 },
    });
    expect(inbound.verify).not.toHaveProperty("secret");
    if (!secret) throw new Error("missing generated secret");
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing local board");
    const board = store.board(testScope(keys));
    const record = await board.inboundEndpoint(inbound.id);
    if (!record) throw new Error("missing inbound endpoint");
    expect(record.inbound).not.toHaveProperty("url");
    await board.write(async (writer) => {
      const sealed = await writer.inboundSecret(inbound.id);
      if (!sealed) throw new Error("missing sealed verify secret");
      expect(JSON.stringify(sealed)).not.toContain(secret);
      expect(openSecret(key, INBOUND_VERIFY_INFO, inbound.id, sealed)?.secret === secret).toBe(true);
      expect(openSecret(key, INBOUND_VERIFY_INFO, "ib_other", sealed)).toBeNull();
      expect(await writer.activeGrant(record.grantId)).toMatchObject({
        can: spec.can,
        principals: [{ kind: "hook", inbound: inbound.id }],
      });
    });
    expect(await (await call(app, "GET", "/x/inbound")).json()).toEqual({ inbound: [inbound] });
    expect(await (await call(app, "GET", path)).json()).toEqual(inbound);

    const nextRules = [{ when: {}, do: [{ reply: "Updated: {{body.summary}}" }] }];
    const update = await call(app, "POST", path, { rules: nextRules });
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({ ...inbound, rules: nextRules });
    expect(await (await call(app, "GET", path)).json()).toEqual({ ...inbound, rules: nextRules });

    expect(await (await call(app, "POST", `${path}/delete`)).json()).toEqual({ id: inbound.id });
    expect((await call(app, "GET", path)).status).toBe(404);
    await board.write(async (writer) => {
      expect(await writer.activeGrant(record.grantId)).toBeNull();
      expect(await writer.inboundSecret(inbound.id)).toBeNull();
    });
    const { events } = await board.auditEvents(0, 100);
    expect(events.filter((event) => event.type.startsWith("ob.inbound.")).map(({ type }) => type)).toEqual([
      "ob.inbound.created",
      "ob.inbound.updated",
      "ob.inbound.deleted",
    ]);
    expect(JSON.stringify(events)).not.toContain(secret);
  } finally {
    await app.close();
  }
});

test("rejects unsupported actions and a creator without manage throughout the grant", async () => {
  const app = makeApp({ secretKey: key });
  try {
    const invalid = await call(app, "POST", "/x/inbound", {
      ...spec,
      rules: [{ when: {}, do: [{ "task.expire": {} }] }],
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_rule" } });
    const connection = await call(app, "POST", "/x/connections", {
      name: "limited",
      direct: true,
      can: { "work/": "all", "work/private/": ["read"] },
    });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
    const forbidden = await app.fetch(
      new Request(`${BOARD_URL}/x/inbound`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify(spec),
      }),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ error: { code: "forbidden" } });
  } finally {
    await app.close();
  }
});

test("omits caller-supplied verify secrets and enforces 20 endpoints per board", async () => {
  const app = makeApp({ secretKey: key });
  try {
    for (let index = 0; index < 20; index++) {
      const created = await call(app, "POST", "/x/inbound", {
        ...spec,
        name: `runner-${index}`,
        verify: { ...spec.verify, secret: "caller supplied fixture" },
      });
      expect(created.status).toBe(201);
      const body = await created.json();
      expect(body).not.toHaveProperty("secret");
      expect(JSON.stringify(body)).not.toContain("caller supplied fixture");
    }
    const exhausted = await call(app, "POST", "/x/inbound", spec);
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toMatchObject({ error: { code: "quota_exceeded", reason: "inbound" } });
  } finally {
    await app.close();
  }
});

test("rejects outbound custom signing schemes for inbound verification", async () => {
  const app = makeApp({ secretKey: key, webhookCustomSigning: true });
  try {
    const result = await call(app, "POST", "/x/inbound", {
      ...spec,
      verify: {
        algorithm: "hmac-sha256",
        signatureHeader: "x-signature",
        signatureFormat: "{sig}",
        encoding: "hex",
        signedPayload: "{body}",
      },
    });
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: { code: "invalid_signing" } });
  } finally {
    await app.close();
  }
});
