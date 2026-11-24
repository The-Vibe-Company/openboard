import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { createWebhook, OutputOf, testWebhook } from "@openboard/contract";
import type { Jobs } from "@openboard/ports";
import { BOARD_URL, call, makeApp, NOW } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";

const spec = {
  name: "test-receiver",
  url: "http://127.0.0.1:9000/hook",
  filter: { tail: "dev" },
};

async function json<T>(response: Promise<Response>, status: number): Promise<T> {
  const result = await response;
  expect(result.status).toBe(status);
  return (await result.json()) as T;
}

function setup(status: number | null, resolveHost?: (host: string) => Promise<string[]>) {
  let now = NOW;
  const store = openSnapshotStore(() => now);
  const requests: Request[] = [];
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const app = makeApp({
    store,
    now: () => now,
    secretKey: new Uint8Array(32).fill(12),
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    ...(resolveHost && { resolveHost }),
    webhookFetch: async (request) => {
      now += 12;
      requests.push(request);
      if (status === null) throw new Error("connection refused");
      return new Response(null, {
        status,
        ...(status === 302 && { headers: { location: "http://127.0.0.1:9000/redirect" } }),
      });
    },
  });
  return {
    app,
    requests,
    async dispatch() {
      now += 86_400_000;
      await Promise.all(wakes.map((wake) => wake()));
    },
    async rows() {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("missing board");
      return (await store.tenantRows(keys)).rows.webhook_deliveries ?? [];
    },
  };
}

test.each([[200], [302], [500], [410], [null]] as const)(
  "sends one signed ping and records receiver status %s",
  async (status) => {
    const { app, requests, dispatch, rows } = setup(status);
    try {
      const { webhook, secret } = await json<OutputOf<typeof createWebhook>>(
        call(app, "POST", "/x/webhooks", spec),
        201,
      );
      if (!secret) throw new Error("missing generated webhook secret");
      const path = `/x/webhooks/${webhook.id}/test`;
      const { delivery } = await json<OutputOf<typeof testWebhook>>(call(app, "POST", path), 200);
      const { id } = delivery;
      expect(id).toMatch(/^dl_[a-z2-7]{16}$/);
      expect(delivery).toEqual({
        id,
        status,
        ok: status === 200,
        ms: 12,
        ...(status === null && { error: "unreachable" }),
      });
      expect(requests).toHaveLength(1);
      const [request] = requests;
      if (!request) throw new Error("missing ping");
      expect(request.url).toBe(spec.url);
      expect(request.method).toBe("POST");
      expect(request.redirect).toBe("manual");
      const body = await request.text();
      const timestamp = String(NOW / 1000);
      const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
        .update(`${id}.${timestamp}.${body}`)
        .digest("base64");
      expect(request.headers.get("webhook-id")).toBe(id);
      expect(request.headers.get("webhook-timestamp")).toBe(timestamp);
      expect(request.headers.get("webhook-signature")).toBe(`v1,${signature}`);
      expect(JSON.parse(body)).toEqual({
        type: "board.ping",
        version: 1,
        delivery: { id, attempt: 1, webhook: webhook.id, name: spec.name },
        board: { url: BOARD_URL, org: "local", board: "main" },
      });
      await dispatch();
      expect(requests).toHaveLength(1);
      const deliveries = await rows();
      expect(deliveries).toMatchObject([
        { id, event: null, thread: null, type: "board.ping", state: status === 200 ? "done" : "dead" },
      ]);
      expect(Number(deliveries[0]?.attempt)).toBe(1);
      const recordedStatus = deliveries[0]?.last_status;
      expect(recordedStatus === null ? null : Number(recordedStatus)).toBe(status);
      expect(await json(call(app, "GET", `/x/webhooks/${webhook.id}`), 200)).toMatchObject({ enabled: true });
    } finally {
      await app.close();
    }
  },
);

test("returns not_found for a deleted or unknown webhook", async () => {
  const { app, requests, rows } = setup(200);
  try {
    const { webhook } = await json<OutputOf<typeof createWebhook>>(call(app, "POST", "/x/webhooks", spec), 201);
    await json(call(app, "POST", `/x/webhooks/${webhook.id}/delete`), 200);
    const unknown = `wh_${"a".repeat(16)}`;
    for (const id of [webhook.id, unknown]) {
      expect(await json(call(app, "POST", `/x/webhooks/${id}/test`), 404)).toMatchObject({
        error: { code: "not_found" },
      });
    }
    expect(requests).toHaveLength(0);
    expect(await rows()).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test("rechecks the target before pinging and does not connect after DNS changes to a private address", async () => {
  let address = "8.8.8.8";
  const { app, requests, rows } = setup(200, async () => [address]);
  try {
    const { webhook } = await json<OutputOf<typeof createWebhook>>(
      call(app, "POST", "/x/webhooks", { ...spec, url: "https://receiver.example/hook" }),
      201,
    );
    address = "10.0.0.5";
    const { delivery } = await json<OutputOf<typeof testWebhook>>(
      call(app, "POST", `/x/webhooks/${webhook.id}/test`),
      200,
    );
    expect(delivery).toMatchObject({ status: null, ok: false, error: "unreachable" });
    expect(requests).toHaveLength(0);
    expect(await rows()).toMatchObject([{ type: "board.ping", state: "dead", last_error: "invalid_url" }]);
  } finally {
    await app.close();
  }
});

test("signs a test ping with the GitHub preset over the sent body", async () => {
  const { app, requests } = setup(200);
  const secret = "test receiver fixture";
  try {
    const { webhook } = await json<OutputOf<typeof createWebhook>>(
      call(app, "POST", "/x/webhooks", { ...spec, signing: { preset: "github", secret } }),
      201,
    );
    const { delivery } = await json<OutputOf<typeof testWebhook>>(
      call(app, "POST", `/x/webhooks/${webhook.id}/test`),
      200,
    );
    expect(requests).toHaveLength(1);
    const [request] = requests;
    if (!request) throw new Error("missing ping");
    const body = Buffer.from(await request.arrayBuffer());
    expect(JSON.parse(body.toString("utf8")).type).toBe("board.ping");
    expect(request.redirect).toBe("manual");
    expect(request.headers.get("x-github-delivery")).toBe(delivery.id);
    expect(request.headers.get("x-hub-signature-256")).toBe(
      `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    );
  } finally {
    await app.close();
  }
});
