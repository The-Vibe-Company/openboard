import { expect, test } from "bun:test";
import type { createWebhook, OutputOf, WebhookSpec } from "@openboard/contract";
import { type Jobs, WEBHOOK_DELIVERY_JOB } from "@openboard/ports";
import { call, makeApp, NOW } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";

const spec = {
  name: "receiver",
  url: "http://127.0.0.1:9000/hook",
  filter: { tail: "dev", types: ["message.posted"] },
};
const headers = { authorization: "Bearer receiver fixture", "x-receiver": "private fixture" };
const masked = { authorization: "…", "x-receiver": "…" };
const secretKey = new Uint8Array(32).fill(12);

test.each(["none", "standard-webhooks"])("delivers private static headers with signing preset %s", async (preset) => {
  const store = openSnapshotStore(() => NOW);
  const requests: Request[] = [];
  const logs: Record<string, unknown>[] = [];
  const log = (message: string, fields: Record<string, unknown>) => logs.push({ message, ...fields });
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const app = makeApp({
    store,
    secretKey,
    webhookCustomSigning: true,
    log: { info: log, error: log },
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      requests.push(request);
      return new Response(null, { status: 204 });
    },
  });
  try {
    const created = await call(app, "POST", "/x/webhooks", { ...spec, signing: { preset }, headers });
    expect(created.status).toBe(201);
    const result = (await created.json()) as OutputOf<typeof createWebhook>;
    const { webhook } = result;
    expect(webhook.headers).toEqual(masked);
    if (preset === "none") expect(result).not.toHaveProperty("secret");
    const read = await call(app, "GET", `/x/webhooks/${webhook.id}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ headers: masked });

    const sameOrigin = `${spec.url}?updated=1`;
    const updated = await call(app, "POST", `/x/webhooks/${webhook.id}`, { url: sameOrigin });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ webhook: { url: sameOrigin, headers: masked } });

    expect((await call(app, "POST", "/messages", { channel: "dev", text: "a thread" })).status).toBe(201);
    await Promise.all(wakes.map((wake) => wake()));

    expect(requests).toHaveLength(1);
    const [request] = requests;
    if (!request) throw new Error("missing delivery");
    expect(request.url).toBe(sameOrigin);
    for (const [name, value] of Object.entries(headers)) expect(request.headers.get(name)).toBe(value);
    const signingHeaders = ["webhook-id", "webhook-signature", "webhook-timestamp"];
    const expected = ["accept-encoding", "authorization", "content-type", "host", "x-receiver"];
    if (preset !== "none") expected.push(...signingHeaders);
    expect([...request.headers.keys()]).toEqual(expected.sort());

    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing local board");
    const { rows } = await store.tenantRows(keys);
    expect(JSON.parse(String(rows.webhooks?.[0]?.config))).toMatchObject({ headers: masked });
    expect(rows.webhook_secrets).toHaveLength(1);
    expect(logs).toContainEqual(expect.objectContaining({ message: "job completed", kind: WEBHOOK_DELIVERY_JOB }));
    for (const value of Object.values(headers)) {
      expect(JSON.stringify(rows)).not.toContain(value);
      expect(JSON.stringify(logs)).not.toContain(value);
    }
  } finally {
    await app.close();
  }
});

const invalid: Array<[string, WebhookSpec["headers"], WebhookSpec["signing"]?]> = [
  ["content-type", { "Content-Type": "text/plain" }],
  ["content-length", { "content-length": "42" }],
  ["host", { host: "example.org" }],
  ["default signature", { "Webhook-Signature": "value" }, {}],
  ["preset delivery ID", { "X-GitHub-Delivery": "value" }, { preset: "github", secret: "receiver fixture" }],
  [
    "receiver-chosen timestamp",
    { "X-TS": "value" },
    {
      preset: "ts-id-body",
      signatureHeader: "x-signature",
      timestampHeader: "x-ts",
      idHeader: "x-id",
    },
  ],
  ["non-token name", { "bad name": "value" }],
  ["line break", { "x-receiver": "line one\r\nline two" }],
  ["duplicate name", { "x-receiver": "one", "X-Receiver": "two" }],
  ["21 headers", Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`x-receiver-${index}`, "value"]))],
];

test.each(invalid)(
  "rejects a static header configuration with %s",
  async (_name, headers, signing = { preset: "none" }) => {
    const app = makeApp({ secretKey, webhookCustomSigning: true });
    try {
      const response = await call(app, "POST", "/x/webhooks", { ...spec, signing, headers });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    } finally {
      await app.close();
    }
  },
);

test("requires the rollout flag to set the none preset or static headers on create or update", async () => {
  const app = makeApp({ secretKey });
  try {
    const signing = { preset: "none" };
    const refused = await call(app, "POST", "/x/webhooks", { ...spec, signing });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "invalid_signing" } });

    const refusedHeaders = await call(app, "POST", "/x/webhooks", { ...spec, headers });
    expect(refusedHeaders.status).toBe(400);
    expect(await refusedHeaders.json()).toMatchObject({
      error: { code: "invalid_request", message: expect.stringContaining("headers") },
    });

    const created = await call(app, "POST", "/x/webhooks", spec);
    expect(created.status).toBe(201);
    const { webhook } = (await created.json()) as OutputOf<typeof createWebhook>;
    const update = await call(app, "POST", `/x/webhooks/${webhook.id}`, { signing });
    expect(update.status).toBe(400);
    expect(await update.json()).toMatchObject({ error: { code: "invalid_signing" } });
    const updateHeaders = await call(app, "POST", `/x/webhooks/${webhook.id}`, { headers });
    expect(updateHeaders.status).toBe(400);
    expect(await updateHeaders.json()).toMatchObject({
      error: { code: "invalid_request", message: expect.stringContaining("headers") },
    });
  } finally {
    await app.close();
  }
});

test("requires replacing or clearing static headers on a cross-origin URL update", async () => {
  const app = makeApp({ secretKey, webhookCustomSigning: true });
  try {
    const created = await call(app, "POST", "/x/webhooks", { ...spec, headers });
    expect(created.status).toBe(201);
    const { webhook } = (await created.json()) as OutputOf<typeof createWebhook>;
    const path = `/x/webhooks/${webhook.id}`;
    const switched = await call(app, "POST", path, { signing: { preset: "none" } });
    expect(switched.status).toBe(200);
    expect(await switched.json()).toEqual({ webhook: { ...webhook, signing: { preset: "none" } } });
    for (const url of ["http://127.0.0.1:9001/hook", "http://127.0.0.2:9000/hook"]) {
      const rejected = await call(app, "POST", path, { url });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({
        error: { code: "invalid_request", message: expect.stringContaining("headers") },
      });
    }
    const read = await call(app, "GET", path);
    expect(await read.json()).toMatchObject({ url: spec.url, headers: masked });

    const url = "http://127.0.0.1:9001/hook";
    const replaced = await call(app, "POST", path, { url, headers: { "x-replacement": "fixture" } });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({ webhook: { url, headers: { "x-replacement": "…" } } });

    const cleared = await call(app, "POST", path, { url: spec.url, headers: {} });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ webhook: { url: spec.url, headers: {} } });
  } finally {
    await app.close();
  }
});
