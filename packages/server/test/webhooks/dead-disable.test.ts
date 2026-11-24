import { expect, test } from "bun:test";
import type { createWebhook, listWebhookDeliveries, OutputOf, testWebhook } from "@openboard/contract";
import { messages } from "@openboard/core";
import { type Jobs, WEBHOOK_DELIVERY_JOB } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { call, LOCAL_OWNER, makeApp, NOW } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const day = 86_400_000;

function fixture(receiver: () => number | Promise<number> = () => 422) {
  let now = NOW;
  let sends = 0;
  let simultaneous: { remaining: number; ready: PromiseWithResolvers<void> } | undefined;
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const store = openStore(() => now);
  const app = makeApp({
    store,
    now: () => now,
    secretKey: new Uint8Array(32).fill(12),
    schedule: () => () => {},
    watchJobs: (kinds, _schedule, wake) => {
      if (kinds.includes(WEBHOOK_DELIVERY_JOB)) wakes.push(wake);
      return () => {};
    },
    webhookFetch: async () => {
      sends++;
      if (simultaneous) {
        if (--simultaneous.remaining === 0) simultaneous.ready.resolve();
        await simultaneous.ready.promise;
      }
      return new Response(null, { status: await receiver() });
    },
  });
  return {
    app,
    advance: (ms: number) => (now += ms),
    sends: () => sends,
    async seed(count: number) {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("missing board");
      await store.board(testScope(keys)).write(async (writer) => {
        for (let index = 0; index < count; index++) {
          await writer.append(
            messages.decidePost(
              { head: writer.head },
              { channel: "dev", text: "deliver me" },
              { by: { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null }, now },
            ).events,
          );
        }
      });
    },
    async run(together = false) {
      if (together && app.instances.length === 2) {
        expect(wakes).toHaveLength(2);
        simultaneous = { remaining: 2, ready: Promise.withResolvers<void>() };
      }
      try {
        await Promise.all(wakes.map((wake) => wake()));
      } finally {
        simultaneous = undefined;
      }
    },
  };
}

async function subscribe(app: ReturnType<typeof makeApp>) {
  const created = await call(app, "POST", "/x/webhooks", {
    name: "receiver",
    url: "http://127.0.0.1:9000/hook",
    filter: { tail: "dev", types: ["message.posted"] },
  });
  expect(created.status).toBe(201);
  const { webhook } = (await created.json()) as OutputOf<typeof createWebhook>;
  const route = `/x/webhooks/${webhook.id}`;
  return { webhook, route };
}

test("the 101st recent dead event delivery disables its webhook once across workers", async () => {
  const { app, advance, seed, run, sends } = fixture();
  try {
    const { webhook, route } = await subscribe(app);
    const current = async () => (await call(app, "GET", route)).json();
    const dead = async () => {
      const history = await call(app, "GET", `${route}/deliveries?state=dead&limit=200`);
      expect(history.status).toBe(200);
      return ((await history.json()) as OutputOf<typeof listWebhookDeliveries>).deliveries;
    };

    await seed(1);
    await run();
    expect(await dead()).toHaveLength(1);
    advance(day + 1);

    const ping = await call(app, "POST", `${route}/test`);
    expect(ping.status).toBe(200);
    expect(((await ping.json()) as OutputOf<typeof testWebhook>).delivery).toMatchObject({ status: 422, ok: false });
    await seed(1);
    await run();
    advance(2);
    await seed(99);
    await run();
    expect(await current()).toMatchObject({ enabled: true, disabledReason: null });
    expect(await dead()).toHaveLength(102);

    // Let the first of the recent deaths age out, then race two workers from 99 to 101.
    advance(day - 1);

    await seed(2);
    await run(true);
    expect(await current()).toMatchObject({ enabled: false, disabledReason: "dead_deliveries" });
    const audit = (await (await call(app, "GET", "/x/audit")).json()) as { events: { type: string }[] };
    expect(audit.events.filter(({ type }) => type === "ob.webhook.disabled")).toMatchObject([
      { payload: { id: webhook.id, reason: "dead_deliveries" } },
    ]);
    const stoppedAt = sends();
    await seed(1);
    await run();
    expect(sends()).toBe(stoppedAt);
  } finally {
    await app.close();
  }
});

test("a stale 410 still counts toward the subscription's dead delivery limit", async () => {
  let replaceTarget: (() => Promise<Response>) | undefined;
  const { app, seed, run } = fixture(async () => {
    if (!replaceTarget) return 422;
    expect((await replaceTarget()).status).toBe(200);
    return 410;
  });
  try {
    const { route } = await subscribe(app);
    await seed(100);
    await run();
    replaceTarget = () => call(app, "POST", route, { url: "http://127.0.0.1:9001/updated" });
    await seed(1);
    await run();
    expect(await (await call(app, "GET", route)).json()).toMatchObject({
      enabled: false,
      disabledReason: "dead_deliveries",
      url: "http://127.0.0.1:9001/updated",
    });
  } finally {
    await app.close();
  }
});
