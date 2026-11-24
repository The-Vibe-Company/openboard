import { expect, test } from "bun:test";
import type {
  createConnection,
  createWebhook,
  listWebhookDeliveries,
  OutputOf,
  testWebhook,
} from "@openboard/contract";
import { type Jobs, WEBHOOK_DELIVERY_JOB } from "@openboard/ports";
import { seedWebhook, testScope } from "@openboard/ports/testkit";
import { BOARD_URL, call, makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";
import { openStore } from "../support/drivers.ts";

type DeliveryPayload = { type: string; delivery: { id: string; attempt: number } };

function fixture() {
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const sends: Array<DeliveryPayload & { header: string | null }> = [];
  let time = NOW;
  let status = 422;
  let onSend: (() => Promise<void>) | undefined;
  const store = openStore(() => time);
  const app = makeApp({
    store,
    secretKey: new Uint8Array(32).fill(12),
    now: () => time,
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      sends.push({ ...((await request.json()) as DeliveryPayload), header: request.headers.get("webhook-id") });
      await onSend?.();
      return new Response(null, { status });
    },
  });
  return {
    app,
    sends,
    async legacyClaim() {
      return store.jobs.claim([WEBHOOK_DELIVERY_JOB], { instanceId: "legacy", claimedAt: time });
    },
    async run(at = time, receiverStatus = status, duringSend?: () => Promise<void>) {
      time = at;
      status = receiverStatus;
      onSend = duringSend;
      await Promise.all(wakes.map((wake) => wake()));
      onSend = undefined;
    },
    async webhook(name: string, enabled = true) {
      const created = await call(app, "POST", "/x/webhooks", {
        name,
        enabled,
        url: "http://127.0.0.1:9000/hook",
        filter: { tail: "dev" },
      });
      expect(created.status).toBe(201);
      return ((await created.json()) as OutputOf<typeof createWebhook>).webhook.id;
    },
    async list(id: string) {
      const response = await call(app, "GET", `/x/webhooks/${id}/deliveries`);
      expect(response.status).toBe(200);
      return ((await response.json()) as OutputOf<typeof listWebhookDeliveries>).deliveries;
    },
    async ping(id: string) {
      const response = await call(app, "POST", `/x/webhooks/${id}/test`);
      expect(response.status).toBe(200);
      return ((await response.json()) as OutputOf<typeof testWebhook>).delivery.id;
    },
  };
}

const route = (id: string, dl: string) => `/x/webhooks/${id}/deliveries/${dl}/retry`;

async function expectError(response: Response, status: number, code: string, message?: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code, ...(message && { message }) } });
}

test("queues a dead event with a fresh schedule and rejects pending, sending and done deliveries", async () => {
  const { app, run, webhook, list, sends } = fixture();
  try {
    const id = await webhook("events");
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "deliver me" })).status).toBe(201);
    const [original] = await list(id);
    if (!original) throw new Error("missing event delivery");
    const retry = () => call(app, "POST", route(id, original.id));
    const rejectRetry = async () => {
      await expectError(await retry(), 400, "invalid_request", "only a dead delivery is sent again");
    };

    await rejectRetry();
    await run(NOW, 422, rejectRetry);
    expect(await list(id)).toMatchObject([{ state: "dead", attempt: 1, lastStatus: 422 }]);
    const other = await webhook("other");
    await expectError(await call(app, "POST", route(other, original.id)), 404, "not_found");

    const connection = await call(app, "POST", "/x/connections", {
      name: "reader",
      direct: true,
      can: { dev: ["read"] },
    });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
    await expectError(
      await app.fetch(
        new Request(BOARD_URL + route(id, original.id), {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
        }),
      ),
      403,
      "forbidden",
    );

    await run(NOW + 1234);
    const queued = await retry();
    expect(queued.status).toBe(200);
    expect(await queued.json()).toEqual({ id: original.id });
    expect(await list(id)).toEqual([original]);
    await run(NOW + 1233, 204);
    expect(sends).toHaveLength(1);
    await run(NOW + 1234);
    expect(sends).toHaveLength(2);
    expect(sends[1]).toEqual(sends[0]);
    expect(sends[1]).toMatchObject({
      type: "board.event",
      header: original.id,
      delivery: { id: original.id, attempt: 1 },
    });
    expect(await list(id)).toMatchObject([{ id: original.id, state: "done", attempt: 1, lastStatus: 204 }]);
    await rejectRetry();
  } finally {
    await app.close();
  }
});

test("manually re-sends a dead ping once, even if its receiver returns a retryable status", async () => {
  const { app, webhook, ping, run, list, sends, legacyClaim } = fixture();
  try {
    const id = await webhook("test-ping");
    const dl = await ping(id);
    expect((await call(app, "POST", route(id, dl))).status).toBe(200);
    expect((await legacyClaim()).job).toBeNull();
    await run(NOW, 503);
    await run(NOW + 10_000, 204);
    expect(sends).toHaveLength(2);
    expect(sends[1]).toEqual(sends[0]);
    expect(sends[1]).toMatchObject({ type: "board.ping", header: dl, delivery: { id: dl, attempt: 1 } });
    expect(await list(id)).toMatchObject([{ id: dl, state: "dead", attempt: 1, lastStatus: 503 }]);
  } finally {
    await app.close();
  }
});

test("a re-send on a disabled webhook stays pending", async () => {
  const { app, webhook, ping, run, list, sends } = fixture();
  try {
    const id = await webhook("disabled", false);
    const dl = await ping(id);
    expect((await call(app, "POST", route(id, dl))).status).toBe(200);
    await run(NOW + 10_000, 204);
    expect(sends).toHaveLength(1);
    expect(await list(id)).toMatchObject([{ id: dl, state: "pending", attempt: 0, doneAt: null }]);
  } finally {
    await app.close();
  }
});

test("returns not_found for a delivery on another board in the caller's organization", async () => {
  const store = openStore(() => NOW);
  const app = makeBrowserApp(undefined, store);
  try {
    const { headers, principal } = await browserSession(app.fetch, "ada");
    const post = (path: string, body?: object) =>
      app.fetch(
        new Request(`${PUBLIC_URL}/api${path}`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect((await post("/x/orgs", { slug: "acme", name: "Acme" })).status).toBe(201);
    expect((await post("/x/orgs/acme/boards", { slug: "ops", name: "Ops" })).status).toBe(201);
    const main = await store.platform().findBoard("acme", "main");
    const ops = await store.platform().findBoard("acme", "ops");
    if (!main || !ops) throw new Error("missing boards");
    const owner = await seedWebhook(store.board(testScope(main)), "main", principal);
    const foreign = await seedWebhook(store.board(testScope(ops)), "foreign", principal);
    const ping = await post(`/acme/ops/x/webhooks/${foreign.webhook.id}/test`);
    expect(ping.status).toBe(200);
    const { delivery } = (await ping.json()) as OutputOf<typeof testWebhook>;
    await expectError(await post(`/acme/main${route(owner.webhook.id, delivery.id)}`), 404, "not_found");
  } finally {
    await app.close();
  }
});
