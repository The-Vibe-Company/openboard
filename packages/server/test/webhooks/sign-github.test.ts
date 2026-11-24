import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { createWebhook, OutputOf } from "@openboard/contract";
import type { Jobs } from "@openboard/ports";
import { signWebhook, webhookSigningScheme } from "../../src/jobs/sign.ts";
import { call, makeApp, NOW } from "../support/app.ts";

test("matches the published GitHub signature and sends the delivery ID", () => {
  const id = "dl_aaaaaaaaaaaaaaaa";
  const headers = signWebhook(webhookSigningScheme("github"), id, NOW, "Hello, World!", "It's a Secret to Everybody");

  expect(headers.get("x-hub-signature-256")).toBe(
    "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
  );
  expect(headers.get("x-github-delivery")).toBe(id);
});

test("signs the delivered bytes with the receiver's secret and omits it from create", async () => {
  const requests: Request[] = [];
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const app = makeApp({
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
  const spec = {
    name: "receiver",
    url: "http://127.0.0.1:9000/hook",
    filter: { tail: "dev", types: ["message.posted"] },
  };
  const secret = "receiver's café fixture";
  try {
    const response = await call(app, "POST", "/x/webhooks", { ...spec, signing: { preset: "github", secret } });
    expect(response.status).toBe(201);
    const created = (await response.json()) as OutputOf<typeof createWebhook>;
    expect(created).not.toHaveProperty("secret");
    expect(created.webhook.signing).toEqual({ preset: "github" });

    const post = await call(app, "POST", "/messages", { channel: "dev", text: "café {ts} $&" });
    expect(post.status).toBe(201);
    await Promise.all(wakes.map((wake) => wake()));

    expect(requests).toHaveLength(1);
    const [request] = requests;
    if (!request) throw new Error("missing delivery");
    const bytes = Buffer.from(await request.arrayBuffer());
    const { delivery } = JSON.parse(bytes.toString("utf8"));
    expect(delivery.id).toMatch(/^dl_[a-z2-7]{16}$/);
    expect(delivery.webhook).toBe(created.webhook.id);
    expect(request.headers.get("x-github-delivery")).toBe(delivery.id);
    expect(request.headers.get("x-hub-signature-256")).toBe(
      `sha256=${createHmac("sha256", secret).update(bytes).digest("hex")}`,
    );
    expect(request.headers.has("webhook-signature")).toBe(false);
    expect(request.headers.has("webhook-timestamp")).toBe(false);
  } finally {
    await app.close();
  }
});

test.each(["github", "unknown"])("rejects %s signing without a usable secret", async (preset) => {
  const app = makeApp();
  try {
    const response = await call(app, "POST", "/x/webhooks", {
      name: "receiver",
      url: "http://127.0.0.1:9000/hook",
      filter: { tail: "dev" },
      signing: preset === "github" ? { preset } : { preset, secret: "receiver fixture" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_signing" } });
  } finally {
    await app.close();
  }
});
