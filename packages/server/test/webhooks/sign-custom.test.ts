import { expect, test } from "bun:test";
import type { createWebhook, OutputOf, testWebhook } from "@openboard/contract";
import type { Jobs } from "@openboard/ports";
import { CryptoHasher } from "bun";
import { call, makeApp, NOW } from "../support/app.ts";

const secret = "receiver café fixture";
const url = "https://example.com/hook?target=custom";
const signing = {
  algorithm: "hmac-sha512",
  signatureHeader: "x-signature",
  signatureFormat: "sha512={sig}",
  encoding: "base64url",
  signedPayload: "{method} {url}\n{ts}\n{body}",
  timestampHeader: "x-when",
  timestampFormat: "iso8601",
  idHeader: "x-delivery",
} as const;

test.each([
  ["base64url", "iso8601", "2023-11-14T22:13:20.987Z"],
  ["base64", "unix_ms", "1700000000987"],
  ["hex", "unix", "1700000000"],
] as const)(
  "signs events, pings, and resent pings with %s encoding and %s timestamps",
  async (encoding, timestampFormat, ts) => {
    const requests: Request[] = [];
    const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
    let receiverStatus = 204;
    const app = makeApp({
      now: () => NOW + 987,
      webhookCustomSigning: true,
      secretKey: new Uint8Array(32).fill(12),
      resolveHost: async () => ["93.184.216.34"],
      schedule: () => () => {},
      watchJobs: (_kinds, _schedule, wake) => {
        wakes.push(wake);
        return () => {};
      },
      webhookFetch: async (request) => {
        requests.push(request);
        return new Response(null, { status: receiverStatus });
      },
    });

    try {
      const scheme = { ...signing, encoding, timestampFormat };
      const created = await call(app, "POST", "/x/webhooks", {
        name: "receiver",
        url,
        filter: { tail: "dev", types: ["message.posted"] },
        signing: { ...scheme, secret },
      });
      expect(created.status).toBe(201);
      const result = (await created.json()) as OutputOf<typeof createWebhook>;
      expect(result.webhook.signing).toEqual(scheme);
      expect(result).not.toHaveProperty("secret");

      expect((await call(app, "POST", "/messages", { channel: "dev", text: "café {method} $&" })).status).toBe(201);
      await Promise.all(wakes.map((wake) => wake()));
      expect(requests).toHaveLength(1);
      await verifyRequest(requests[0], encoding, ts);

      receiverStatus = 422;
      const ping = await call(app, "POST", `/x/webhooks/${result.webhook.id}/test`);
      expect(ping.status).toBe(200);
      const { delivery } = (await ping.json()) as OutputOf<typeof testWebhook>;
      expect(delivery.status).toBe(422);
      expect(requests).toHaveLength(2);
      expect(await verifyRequest(requests[1], encoding, ts)).toBe(delivery.id);

      receiverStatus = 204;
      const retry = await call(app, "POST", `/x/webhooks/${result.webhook.id}/deliveries/${delivery.id}/retry`);
      expect(retry.status).toBe(200);
      await Promise.all(wakes.map((wake) => wake()));
      expect(requests).toHaveLength(3);
      expect(await verifyRequest(requests[2], encoding, ts)).toBe(delivery.id);
    } finally {
      await app.close();
    }
  },
);

async function verifyRequest(
  request: Request | undefined,
  encoding: typeof signing.encoding | "base64" | "hex",
  ts: string,
) {
  if (!request) throw new Error("missing outbound request");
  expect(request.method).toBe("POST");
  expect(request.url).toBe("https://93.184.216.34/hook?target=custom");
  expect(request.headers.get("x-when")).toBe(ts);
  const body = Buffer.from(await request.arrayBuffer());
  const { delivery } = JSON.parse(body.toString("utf8"));
  expect(delivery.id).toMatch(/^dl_[a-z2-7]{16}$/);
  expect(request.headers.get("x-delivery")).toBe(delivery.id);
  const digest = new CryptoHasher("sha512", secret).update(`POST ${url}\n${ts}\n`).update(body).digest(encoding);
  expect(request.headers.get("x-signature")).toBe(`sha512=${digest}`);
  return delivery.id;
}

test("returns HTTP 400 invalid_signing for an unknown custom algorithm", async () => {
  const app = makeApp({ webhookCustomSigning: true });
  try {
    const response = await call(app, "POST", "/x/webhooks", {
      name: "receiver",
      url,
      filter: { tail: "dev" },
      signing: { ...signing, algorithm: "sha512" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_signing", message: expect.stringContaining("algorithm") },
    });
  } finally {
    await app.close();
  }
});

test("blocks custom webhook creation by default with HTTP 400 invalid_signing", async () => {
  const app = makeApp({ secretKey: new Uint8Array(32).fill(12) });
  try {
    const response = await call(app, "POST", "/x/webhooks", {
      name: "receiver",
      url,
      filter: { tail: "dev" },
      signing,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_signing", message: expect.stringContaining("OPENBOARD_WEBHOOK_CUSTOM_SIGNING") },
    });
  } finally {
    await app.close();
  }
});

test.each([false, true])("updates custom signing only when the flag is on (%s)", async (webhookCustomSigning) => {
  const app = makeApp({
    secretKey: new Uint8Array(32).fill(12),
    webhookCustomSigning,
    resolveHost: async () => ["93.184.216.34"],
    schedule: () => () => {},
  });
  try {
    const created = await call(app, "POST", "/x/webhooks", { name: "receiver", url, filter: { tail: "dev" } });
    expect(created.status).toBe(201);
    const { webhook } = (await created.json()) as OutputOf<typeof createWebhook>;
    const route = `/x/webhooks/${webhook.id}`;
    const updated = await call(app, "POST", route, { signing });
    if (webhookCustomSigning) {
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ webhook: { signing } });
    } else {
      expect(updated.status).toBe(400);
      expect(await updated.json()).toMatchObject({ error: { code: "invalid_signing" } });
      expect(await (await call(app, "GET", route)).json()).toEqual(webhook);
    }
  } finally {
    await app.close();
  }
});
