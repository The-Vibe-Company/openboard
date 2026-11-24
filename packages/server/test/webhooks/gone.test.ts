import { expect, test } from "bun:test";
import type { createWebhook, listWebhookDeliveries, OutputOf, postMessage, updateWebhook } from "@openboard/contract";
import { type Jobs, WEBHOOK_DELIVERY_JOB, WEBHOOK_RESEND_JOB } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { call, makeApp, NOW } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const spec = {
  name: "receiver",
  url: "http://127.0.0.1:9000/hook",
  filter: { tail: "dev", types: ["message.posted"] },
};

function deliveryFixture(response: (attempt: number) => number | Promise<number>) {
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const attempts: string[] = [];
  let time = NOW;
  const store = openStore(() => time);
  const app = makeApp({
    store,
    now: () => time,
    secretKey: new Uint8Array(32).fill(12),
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      attempts.push(request.headers.get("webhook-id") ?? "");
      return new Response(null, { status: await response(attempts.length) });
    },
  });
  return {
    app,
    store,
    attempts,
    advance(ms: number) {
      time += ms;
      return time;
    },
    run: () => Promise.all(wakes.map((wake) => wake())),
  };
}

test("a 410 pauses the subscription, preserves its waiting deliveries and audits the reason", async () => {
  const { app, store, attempts, advance, run } = deliveryFixture((attempt) => [503, 410][attempt - 1] ?? 204);
  const post = async () => {
    const response = await call(app, "POST", "/messages", { channel: "dev", text: "deliver me" });
    expect(response.status).toBe(201);
    return Number(((await response.json()) as OutputOf<typeof postMessage>).message.id);
  };
  try {
    const creation = await call(app, "POST", "/x/webhooks", spec);
    expect(creation.status).toBe(201);
    const { webhook: initial } = (await creation.json()) as OutputOf<typeof createWebhook>;
    const route = `/x/webhooks/${initial.id}`;
    const list = async () => {
      const result = await call(app, "GET", `${route}/deliveries`);
      expect(result.status).toBe(200);
      return ((await result.json()) as OutputOf<typeof listWebhookDeliveries>).deliveries;
    };
    const retry = await post();
    await run();
    const time = advance(10_000);
    const lease = { instanceId: "older-worker", claimedAt: time };
    const { job: leased } = await store.jobs.claim([WEBHOOK_DELIVERY_JOB, WEBHOOK_RESEND_JOB], lease);
    if (!leased) throw new Error("missing retry job");
    const gone = await post();
    await run();
    expect(await (await call(app, "GET", route)).json()).toMatchObject({ enabled: false, disabledReason: "gone" });
    const audit = await (await call(app, "GET", "/x/audit")).json();
    expect(audit).toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ type: "ob.webhook.disabled", payload: { id: initial.id, reason: "gone" } }),
      ]),
    });
    const ignored = await post();
    const picked = await store.jobs.claim([WEBHOOK_DELIVERY_JOB, WEBHOOK_RESEND_JOB], {
      instanceId: "older-worker",
      claimedAt: time,
    });
    expect(picked.job).toBeNull();
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing board");
    const board = store.board(testScope(keys));
    expect(await board.write((writer) => writer.readJob(leased.id, lease, time))).toBeNull();
    await run();
    expect(attempts).toHaveLength(2);
    const paused = await list();
    expect(paused.find(({ event }) => event === gone)).toMatchObject({ state: "dead", lastStatus: 410, attempt: 1 });
    expect(paused.find(({ event }) => event === retry)).toMatchObject({
      state: "pending",
      lastStatus: 503,
      attempt: 1,
    });
    expect(paused.some(({ event }) => event === ignored)).toBe(false);

    const enabled = await call(app, "POST", route, { enabled: true });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toEqual({ webhook: initial });
    expect(await board.write((writer) => writer.takeJob(leased.id, lease, time))).toBeNull();
    await run();
    expect(attempts).toHaveLength(3);
    expect(attempts[2]).toBe(attempts[0]);
    expect((await list()).find(({ event }) => event === retry)).toMatchObject({ state: "done", attempt: 2 });
  } finally {
    await app.close();
  }
});

test("partial webhook edits share creation validation and rotate signing credentials", async () => {
  const app = makeApp({ secretKey: new Uint8Array(32).fill(12) });
  try {
    const creation = await call(app, "POST", "/x/webhooks", spec);
    expect(creation.status).toBe(201);
    const original = (await creation.json()) as OutputOf<typeof createWebhook>;
    const route = `/x/webhooks/${original.webhook.id}`;
    for (const [patch, code] of [
      [{ name: "" }, "invalid_request"],
      [{ url: "file:///tmp/webhook" }, "invalid_url"],
      [{ filter: { tail: "dev$", types: ["message.posted"] } }, "bad_watcher"],
      [{ headers: { "x-custom": "value" } }, "invalid_signing"],
      [{ body: "invalid" }, "invalid_request"],
    ] as const) {
      const invalid = await call(app, "POST", route, patch);
      expect(invalid.status, code).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code } });
    }
    const patch = {
      name: "updated",
      url: "http://127.0.0.1:9001/hook",
      filter: { tail: "ops", types: ["message.posted"] },
      headers: {},
      body: { id: "{{delivery.id}}" },
    };
    const response = await call(app, "POST", route, patch);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ webhook: { ...original.webhook, ...patch } });

    const rotate = await call(app, "POST", route, { signing: { preset: "stripe" } });
    expect(rotate.status).toBe(200);
    expect(rotate.headers.get("cache-control")).toBe("no-store");
    const updated = (await rotate.json()) as OutputOf<typeof updateWebhook>;
    expect(updated.webhook.signing).toEqual({ preset: "stripe" });
    expect(updated.secret).toBeDefined();
    expect(updated.secret).not.toEqual(original.secret);
    expect(await (await call(app, "GET", route)).json()).toEqual(updated.webhook);
  } finally {
    await app.close();
  }
});

test("a 410 at the daily cap still kills the delivery and appends the disable event", async () => {
  const { app, store, run } = deliveryFixture(() => 410);
  try {
    const creation = await call(app, "POST", "/x/webhooks", spec);
    expect(creation.status).toBe(201);
    const { webhook } = (await creation.json()) as OutputOf<typeof createWebhook>;
    const platform = store.platform();
    const keys = await platform.findBoard("local", "main");
    if (!keys) throw new Error("missing board");
    expect(await platform.setOrgQuotas(keys.orgId, { eventsPerBoardPerDay: 3 })).toBe(true);
    const input = { channel: "dev", text: "fill the quota" };
    expect((await call(app, "POST", "/messages", input)).status).toBe(201);
    expect((await call(app, "POST", "/messages", input)).status).toBe(429);

    await run();

    const route = `/x/webhooks/${webhook.id}`;
    expect(await (await call(app, "GET", route)).json()).toMatchObject({ enabled: false, disabledReason: "gone" });
    expect(await (await call(app, "GET", `${route}/deliveries`)).json()).toMatchObject({
      deliveries: [{ state: "dead", lastStatus: 410 }],
    });
    expect(await (await call(app, "GET", "/x/audit")).json()).toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ type: "ob.webhook.disabled", payload: { id: webhook.id, reason: "gone" } }),
      ]),
    });
    expect((await call(app, "POST", "/messages", input)).status).toBe(429);
    expect(await platform.setOrgQuotas(keys.orgId, { eventsPerBoardPerDay: 4 })).toBe(true);
    expect((await call(app, "POST", "/messages", input)).status).toBe(201);
  } finally {
    await app.close();
  }
});

test("a paused in-flight 410 settles its delivery without disabling the re-enabled subscription", async () => {
  const entered = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<number>();
  const { app, store, attempts, run } = deliveryFixture(() => {
    entered.resolve();
    return answer.promise;
  });
  try {
    const creation = await call(app, "POST", "/x/webhooks", spec);
    expect(creation.status).toBe(201);
    const { webhook } = (await creation.json()) as OutputOf<typeof createWebhook>;
    const route = `/x/webhooks/${webhook.id}`;
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "already in flight" })).status).toBe(201);
    const sending = run();
    try {
      await Promise.race([
        entered.promise,
        sending.then(() => {
          throw new Error("delivery did not start");
        }),
      ]);
      expect((await call(app, "POST", route, { enabled: false })).status).toBe(200);
      expect((await call(app, "POST", route, { enabled: true })).status).toBe(200);
      const claim = await store.jobs.claim([WEBHOOK_DELIVERY_JOB], { instanceId: "free-worker", claimedAt: NOW });
      expect(claim.job).toBeNull();
      if (claim.job === null) expect(claim.nextDue).toBeGreaterThan(NOW);
    } finally {
      answer.resolve(410);
      await sending;
    }

    expect(attempts).toHaveLength(1);
    expect(await (await call(app, "GET", route)).json()).toEqual(webhook);
    expect(await (await call(app, "GET", `${route}/deliveries`)).json()).toMatchObject({
      deliveries: [{ state: "dead", lastStatus: 410, attempt: 1 }],
    });
  } finally {
    await app.close();
  }
});

test("a webhook's new channel scope must cover retained history", async () => {
  const app = makeApp({ secretKey: new Uint8Array(32).fill(12), schedule: () => () => {} });
  try {
    const creation = await call(app, "POST", "/x/webhooks", spec);
    expect(creation.status).toBe(201);
    const { webhook } = (await creation.json()) as OutputOf<typeof createWebhook>;
    const route = `/x/webhooks/${webhook.id}`;
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "queued in dev" })).status).toBe(201);
    const moved = await call(app, "POST", route, { filter: { tail: "ops" } });
    expect(moved.status).toBe(400);
    expect(await moved.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect((await call(app, "POST", route, { filter: { tail: "" } })).status).toBe(200);
  } finally {
    await app.close();
  }
});
