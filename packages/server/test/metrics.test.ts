import { expect, test } from "bun:test";
import type { CreatedConnection, createWebhook, OutputOf } from "@openboard/contract";
import type { Jobs } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { hashToken } from "../src/auth/secrets.ts";
import { BOARD_URL, call, makeApp, NOW, OWNER, PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";
import { openStore } from "./support/drivers.ts";

const operator = "example-metrics";
const metricsConfig = { metricsTokenHash: hashToken(operator), instanceId: "operator-test" };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const scrape = (app: { fetch: (request: Request) => Promise<Response> }, headers?: Record<string, string>) =>
  app.fetch(new Request(`${PUBLIC_URL}/api/x/metrics`, headers && { headers }));

test("metrics are absent by default", async () => {
  const app = makeApp();
  try {
    const response = await scrape(app, bearer(operator));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  } finally {
    await app.close();
  }
});

test("metrics refuse tenant credentials and accept the operator bearer", async () => {
  const app = makeBrowserApp(OWNER.hash, undefined, undefined, undefined, metricsConfig);
  try {
    const [instance] = app.instances;
    if (instance == null) throw new Error("Expected a metrics instance");
    const first = await scrape(instance, bearer(operator));
    expect(first.status).toBe(200);
    expect(await first.text()).toContain(
      'openboard_request_duration_seconds_count{instance="operator-test",route="/api/x/metrics",operation="getMetrics",status="200"} 0\n',
    );
    const session = await browserSession(app.fetch, "ada");
    const created = await call(app, "POST", "/x/connections", { name: "sample", can: { "*": "all" }, direct: true });
    expect(created.status).toBe(201);
    const { secret } = (await created.json()) as CreatedConnection;
    for (const headers of [undefined, bearer(OWNER.token), session.headers, bearer(secret), bearer("wrong")]) {
      const response = await scrape(instance, headers);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
    }
    const response = await scrape(instance, bearer(operator));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; version=0.0.4");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain('openboard_auth_failures_total{instance="operator-test"} 5\n');
    if (app.instances[1]) {
      const other = await scrape(app.instances[1], bearer(operator));
      expect(await other.text()).toContain('openboard_auth_failures_total{instance="operator-test"} 0\n');
    }
  } finally {
    await app.close();
  }
});

test("metrics use route templates and show actual lock, stream and due queue activity", async () => {
  const store = openStore(() => NOW);
  const cluster = makeBrowserApp(OWNER.hash, store, undefined, () => () => {}, metricsConfig);
  const app = cluster.instances[0];
  if (app == null) throw new Error("Expected a metrics instance");
  try {
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing local board");
    await store.board(testScope(keys)).write(async (writer) => {
      await writer.enqueue("webhook-delivery", NOW - 3_000, {});
      await writer.enqueue("webhook-delivery", NOW - 2_000, {});
      await writer.enqueue("webhook-delivery", NOW + 1, {});
    });
    expect((await store.jobs.claim(["webhook-delivery"], { instanceId: "lease", claimedAt: NOW })).job).not.toBeNull();
    expect((await call(app, "POST", "/messages", { channel: "private-channel", text: "private-text" })).status).toBe(
      201,
    );
    await app.fetch(new Request(`${BOARD_URL}/private-unknown-path`));
    const stream = await app.fetch(
      new Request(`${BOARD_URL}/events?after=0`, {
        headers: { ...bearer(OWNER.token), accept: "text/event-stream" },
      }),
    );
    expect(stream.status).toBe(200);
    const body = await (await scrape(app, bearer(operator))).text();
    await stream.body?.cancel();
    expect(body).toContain('openboard_process_resident_bytes{instance="operator-test"} 1024\n');
    expect(body).toContain(
      'openboard_request_duration_seconds_bucket{instance="operator-test",route="/api/:org/:board/messages",operation="postMessage",status="201",le="+Inf"} 1\n',
    );
    expect(body).toMatch(/openboard_board_lock_wait_seconds_count\{instance="operator-test"\} [1-9]\d*\n/);
    expect(body).toContain('openboard_open_streams{instance="operator-test"} 1\n');
    expect(body).toContain('openboard_jobs_due{instance="operator-test",kind="webhook-delivery"} 1\n');
    expect(body).toContain('openboard_jobs_oldest_due_seconds{instance="operator-test",kind="webhook-delivery"} 2\n');
    expect(body).toContain('openboard_webhook_deliveries_total{instance="operator-test",outcome="done"} 0\n');
    for (const tenantValue of ["local", "main", "private-channel", "private-text", "private-unknown-path"]) {
      expect(body).not.toContain(tenantValue);
    }
    expect(await (await scrape(app, bearer(operator))).text()).toContain(
      'openboard_open_streams{instance="operator-test"} 0\n',
    );
  } finally {
    await cluster.close();
  }
});

test("metrics count committed webhook retries, successes and foreground pings", async () => {
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  let status = 503;
  let clock = NOW;
  const app = makeApp({
    ...metricsConfig,
    now: () => clock,
    secretKey: new Uint8Array(32),
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async () => new Response(null, { status }),
  });
  const instance = app.instances[0] ?? app;
  try {
    const created = await call(instance, "POST", "/x/webhooks", {
      name: "sample",
      url: "http://127.0.0.1:9000/hook",
      filter: { tail: "dev", types: ["message.posted"] },
    });
    expect(created.status).toBe(201);
    const { webhook } = (await created.json()) as OutputOf<typeof createWebhook>;
    expect((await call(instance, "POST", "/messages", { channel: "dev", text: "sample" })).status).toBe(201);
    const drive = async () => {
      for (const wake of wakes) await wake();
    };
    await drive();
    status = 204;
    clock += 10_000;
    await drive();
    expect((await call(instance, "POST", `/x/webhooks/${webhook.id}/test`)).status).toBe(200);
    const body = await (await scrape(instance, bearer(operator))).text();
    expect(body).toContain('openboard_webhook_deliveries_total{instance="operator-test",outcome="done"} 2\n');
    expect(body).toContain('openboard_webhook_deliveries_total{instance="operator-test",outcome="retry"} 1\n');
  } finally {
    await app.close();
  }
});
