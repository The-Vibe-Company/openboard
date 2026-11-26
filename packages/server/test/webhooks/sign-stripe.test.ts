import { expect, test } from "bun:test";
import { type Jobs, WEBHOOK_DELIVERY_JOB } from "@openboard/ports";
import { call, makeApp, NOW } from "../support/app.ts";

test("signs the same delivered bytes with a fresh Stripe timestamp after lease recovery", async () => {
  let now = NOW + 999;
  const requests: Request[] = [];
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const app = makeApp({
    now: () => now,
    secretKey: new Uint8Array(32).fill(12),
    schedule: () => () => {},
    watchJobs: (kinds, _schedule, wake) => {
      if (kinds.includes(WEBHOOK_DELIVERY_JOB)) wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      requests.push(request);
      // The first worker loses its lease before it can acknowledge the send.
      if (requests.length === 1) now += 31_000;
      return new Response(null, { status: 204 });
    },
  });
  try {
    const created = await call(app, "POST", "/x/webhooks", {
      name: "receiver",
      url: "http://127.0.0.1:9000/hook",
      filter: { tail: "dev", types: ["message.posted"] },
      body: { message: "{{event.message.text}}" },
      signing: { preset: "stripe", secret: "  receiver fixture  " },
    });
    expect(created.status).toBe(201);
    expect(await created.json()).not.toHaveProperty("secret");
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "café {ts} $&" })).status).toBe(201);
    const wake = wakes[0];
    if (!wake) throw new Error("missing webhook job runner");
    await wake();

    expect(requests).toHaveLength(2);
    // Reference digests from OpenSSL over each timestamp, a period, and the UTF-8 fixture body.
    expect(requests.map((request) => request.headers.get("stripe-signature"))).toEqual([
      "t=1700000000,v1=499761d600c7857305aa50c693d20df0446f1c0a76469c24c1e2127e459c4733",
      "t=1700000031,v1=14fa1a1a22fa295580a53ee0c73e8a8c6cb1f75989a1bde4f14850e0332f682f",
    ]);
    for (const request of requests) {
      expect(await request.text()).toBe('{"message":"café {ts} $&"}');
      expect([...request.headers.keys()]).toEqual(["accept-encoding", "content-type", "host", "stripe-signature"]);
    }
  } finally {
    await app.close();
  }
});
