import { expect, test } from "bun:test";
import type { createWebhook, OutputOf, testWebhook } from "@openboard/contract";
import type { Jobs } from "@openboard/ports";
import { CryptoHasher } from "bun";
import { call, makeApp, NOW } from "../support/app.ts";

const secret = "  public receiver fixture  ";
const signing = { preset: "ts-id-body", signatureHeader: "x-sig", timestampHeader: "x-ts", idHeader: "x-id" } as const;

test("signs delivered events and test pings over Unix seconds, delivery ID, and the raw body", async () => {
  const requests: Request[] = [];
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const app = makeApp({
    now: () => NOW + 999,
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
  try {
    const created = await call(app, "POST", "/x/webhooks", {
      name: "receiver",
      url: "http://127.0.0.1:9000/hook",
      filter: { tail: "dev", types: ["message.posted"] },
      body: { message: "{{event.message.text}}" },
      signing: { ...signing, secret },
    });
    expect(created.status).toBe(201);
    const result = (await created.json()) as OutputOf<typeof createWebhook>;
    expect(result.webhook.signing).toEqual(signing);
    expect(result).not.toHaveProperty("secret");

    expect((await call(app, "POST", "/messages", { channel: "dev", text: "café {ts} $&" })).status).toBe(201);
    await Promise.all(wakes.map((wake) => wake()));
    expect(requests).toHaveLength(1);
    const delivered = await verifySignature(requests[0]);
    expect(delivered.body).toBe('{"message":"café {ts} $&"}');
    // OpenSSL reference for the public fixture key and the delivered UTF-8 bytes.
    expect(delivered.digest).toBe("39cdbc94a35f4ecca0b4079b4a4f0ec2beab7f71bc004b440c61afe488f24629");

    const ping = await call(app, "POST", `/x/webhooks/${result.webhook.id}/test`);
    expect(ping.status).toBe(200);
    const { delivery } = (await ping.json()) as OutputOf<typeof testWebhook>;
    expect(delivery.status).toBe(204);
    expect(requests).toHaveLength(2);
    const verifiedPing = await verifySignature(requests[1]);
    expect(verifiedPing.id).toBe(delivery.id);
    expect(JSON.parse(verifiedPing.body).type).toBe("board.ping");
  } finally {
    await app.close();
  }
});

async function verifySignature(request: Request | undefined) {
  if (!request) throw new Error("missing outbound request");
  const id = request.headers.get("x-id");
  const timestamp = request.headers.get("x-ts");
  const body = await request.text();
  expect(id).toMatch(/^dl_[a-z2-7]{16}$/);
  expect(timestamp).toBe("1700000000");
  const digest = new CryptoHasher("sha256", secret).update(`${timestamp}.${id}.${body}`).digest("hex");
  expect(request.headers.get("x-sig")).toBe(`v1=${digest}`);
  return { body, id, digest };
}

test("returns a field-specific HTTP 400 for a reserved signing header", async () => {
  const app = makeApp();
  try {
    const response = await call(app, "POST", "/x/webhooks", {
      name: "receiver",
      url: "http://127.0.0.1:9000/hook",
      filter: { tail: "dev" },
      signing: { ...signing, timestampHeader: "HOST", secret },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_signing", message: expect.stringContaining("timestampHeader") },
    });
  } finally {
    await app.close();
  }
});
