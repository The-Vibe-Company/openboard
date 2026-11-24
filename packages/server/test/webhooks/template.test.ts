import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { createWebhook, OutputOf } from "@openboard/contract";
import type { Jobs } from "@openboard/ports";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";

const spec = {
  name: "dev-template",
  url: "http://127.0.0.1:9000/hook",
  filter: { tail: "dev --label status=ready", types: ["labels.changed"] },
};

function setup() {
  const store = openSnapshotStore(() => NOW);
  const requests: Request[] = [];
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const app = makeApp({
    store,
    secretKey: new Uint8Array(32).fill(12),
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
  return {
    app,
    requests,
    async run(text: string) {
      const posted = await call(app, "POST", "/messages", { channel: "dev", text });
      expect(posted.status).toBe(201);
      const { message } = (await posted.json()) as { message: { id: string } };
      const labelled = await call(app, "POST", `/messages/${message.id}/labels`, { set: { status: "ready" } });
      expect(labelled.status).toBe(200);
      await Promise.all(wakes.map((wake) => wake()));
      return message.id;
    },
    async deliveries() {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("no local board");
      return (await store.tenantRows(keys)).rows.webhook_deliveries;
    },
  };
}

test("delivers the rendered template and signs the exact JSON bytes sent", async () => {
  const { app, requests, run } = setup();
  try {
    const body = {
      externalRef: "ob:{{subject.thread}}",
      idempotencyKey: "{{delivery.id}}",
      input: { board: "{{board.url}}", labels: "{{subject.labels}}", n: "{{delivery.attempt}}" },
    };
    const created = await call(app, "POST", "/x/webhooks", { ...spec, body });
    expect(created.status).toBe(201);
    const { webhook, secret } = (await created.json()) as OutputOf<typeof createWebhook>;
    if (!secret) throw new Error("missing generated webhook secret");
    expect(webhook.body).toEqual(body);
    const thread = await run("template fixture");
    expect(requests).toHaveLength(1);
    const [request] = requests;
    if (!request) throw new Error("missing request");
    const id = request.headers.get("webhook-id");
    expect(id).toMatch(/^dl_[a-z2-7]{16}$/);
    const raw = await request.text();
    expect(JSON.parse(raw)).toEqual({
      externalRef: `ob:${thread}`,
      idempotencyKey: id,
      input: { board: BOARD_URL, labels: { status: "ready" }, n: 1 },
    });
    const ts = request.headers.get("webhook-timestamp");
    const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
      .update(`${id}.${ts}.${raw}`)
      .digest("base64");
    expect(request.headers.get("webhook-signature")).toBe(`v1,${signature}`);
  } finally {
    await app.close();
  }
});

test("marks a rendered body over 256 KB dead without sending it", async () => {
  const { app, requests, run, deliveries } = setup();
  try {
    const body = ["{{event.message.text}}".repeat(35)];
    const created = await call(app, "POST", "/x/webhooks", { ...spec, body });
    expect(created.status).toBe(201);
    const { webhook } = (await created.json()) as OutputOf<typeof createWebhook>;
    await run("é".repeat(4_000));
    expect(requests).toHaveLength(0);
    expect(await deliveries()).toMatchObject([{ state: "dead", last_error: "too_large" }]);
    const listed = await call(app, "GET", `/x/webhooks/${webhook.id}/deliveries?state=dead`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ deliveries: [{ state: "dead", lastError: "too_large" }] });
  } finally {
    await app.close();
  }
});

test("rejects templates that are scalar JSON or exceed 16 KB in UTF-8", async () => {
  const { app } = setup();
  try {
    for (const body of ["{{subject.thread}}", true, 42, { value: "é".repeat(8_192) }]) {
      const result = await call(app, "POST", "/x/webhooks", { ...spec, body });
      expect(result.status).toBe(400);
      expect(await result.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
  } finally {
    await app.close();
  }
});
