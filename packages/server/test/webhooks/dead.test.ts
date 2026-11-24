import { expect, test } from "bun:test";
import type { createWebhook, listWebhookDeliveries, OutputOf, postMessage, WebhookDelivery } from "@openboard/contract";
import { isoTime } from "@openboard/core";
import type { Jobs } from "@openboard/ports";
import { seedWebhook, testScope } from "@openboard/ports/testkit";
import { call, makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { browserSession, makeBrowserApp } from "../support/browser-session.ts";
import { openStore } from "../support/drivers.ts";

function deliveryFixture() {
  let time = NOW;
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const attempts: string[] = [];
  const app = makeApp({
    now: () => time,
    secretKey: new Uint8Array(32).fill(12),
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      attempts.push(request.headers.get("webhook-id") ?? "");
      if (attempts.length === 1) {
        throw Object.assign(new Error("private TLS error detail"), { code: "EPROTO" });
      }
      return new Response(attempts.length <= 10 ? "private receiver error" : null, {
        status: attempts.length <= 10 ? 503 : 204,
      });
    },
  });
  return {
    app,
    attempts,
    async run(at: number) {
      time = at;
      await Promise.all(wakes.map((wake) => wake()));
    },
    async subscribe() {
      const response = await call(app, "POST", "/x/webhooks", {
        name: "dead-letter",
        url: "http://127.0.0.1:9000/hook",
        filter: { tail: "dev", types: ["message.posted"] },
      });
      expect(response.status).toBe(201);
      const { webhook } = (await response.json()) as OutputOf<typeof createWebhook>;
      return async (query = "") => {
        const page = await call(app, "GET", `/x/webhooks/${webhook.id}/deliveries${query}`);
        expect(page.status).toBe(200);
        return (await page.json()) as OutputOf<typeof listWebhookDeliveries>;
      };
    },
    async post() {
      const response = await call(app, "POST", "/messages", { channel: "dev", text: "deliver me" });
      expect(response.status).toBe(201);
      return Number(((await response.json()) as OutputOf<typeof postMessage>).message.id);
    },
  };
}

test("dead-letters the tenth failing attempt and lists delivery history in filtered pages", async () => {
  const { app, run, subscribe, post, attempts } = deliveryFixture();
  try {
    const list = await subscribe();
    expect(await list()).toEqual({ deliveries: [], older: null });
    const original = await post();
    const pending = await list("?state=pending");
    const delivery = pending.deliveries[0];
    if (!delivery) throw new Error("missing pending delivery");
    expect(delivery).toMatchObject({
      event: original,
      thread: original,
      state: "pending",
      attempt: 0,
      lastStatus: null,
      lastError: null,
      doneAt: null,
    });

    let due = NOW;
    for (const [index, delay] of [0, 10, 30, 120, 600, 1800, 3600, 10800, 21600, 43200].entries()) {
      due += delay * 1000;
      if (delay) {
        await run(due - 1);
        expect(attempts).toHaveLength(index);
      }
      await run(due);
      expect(attempts).toHaveLength(index + 1);
      if (index === 0) {
        expect(await list("?state=pending")).toEqual({
          deliveries: [{ ...delivery, attempt: 1, lastError: "tls" }],
          older: null,
        });
      }
    }
    expect(new Set(attempts)).toEqual(new Set([delivery.id]));
    const dead: WebhookDelivery = {
      ...delivery,
      state: "dead",
      attempt: 10,
      lastStatus: 503,
      lastError: "status",
      doneAt: isoTime(due),
    };
    expect(await list("?state=dead")).toEqual({ deliveries: [dead], older: null });

    const later = due + 24 * 60 * 60 * 1000;
    await run(later);
    expect(attempts).toHaveLength(10);
    const newer = await post();
    await run(later);
    const first = await list("?limit=1");
    expect(first.deliveries).toEqual([
      {
        id: String(attempts[10]),
        event: newer,
        thread: newer,
        state: "done",
        attempt: 1,
        lastStatus: 204,
        lastError: null,
        createdAt: isoTime(later),
        doneAt: isoTime(later),
      },
    ]);
    expect(first.older).toBe(String(attempts[10]));
    expect(await list(`?state=dead&limit=1&before=${first.older}`)).toEqual({ deliveries: [dead], older: null });
    expect(await list("?state=pending")).toEqual({ deliveries: [], older: null });
  } finally {
    await app.close();
  }
});

test("returns not_found for a webhook on another board in the caller's organization", async () => {
  const store = openStore(() => NOW);
  const app = makeBrowserApp(undefined, store);
  try {
    const { headers, principal } = await browserSession(app.fetch, "ada");
    const send = (path: string, body?: object) =>
      app.fetch(
        new Request(`${PUBLIC_URL}/api${path}`, {
          headers: { ...headers, "content-type": "application/json" },
          ...(body && { method: "POST", body: JSON.stringify(body) }),
        }),
      );
    expect((await send("/x/orgs", { slug: "acme", name: "Acme" })).status).toBe(201);
    expect((await send("/x/orgs/acme/boards", { slug: "ops", name: "Ops" })).status).toBe(201);
    const ops = await store.platform().findBoard("acme", "ops");
    if (!ops) throw new Error("missing ops board");
    const { webhook } = await seedWebhook(store.board(testScope(ops)), "foreign", principal);
    const route = `/x/webhooks/${webhook.id}/deliveries`;
    expect((await send(`/acme/ops${route}`)).status).toBe(200);
    const invalid = await send(`/acme/ops${route}?limit=0`);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_request" } });
    const other = await send(`/acme/main${route}`);
    expect(other.status).toBe(404);
    expect(await other.json()).toMatchObject({ error: { code: "not_found" } });
  } finally {
    await app.close();
  }
});
