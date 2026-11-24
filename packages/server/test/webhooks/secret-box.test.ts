import { expect, test } from "bun:test";
import type { createWebhook, OutputOf } from "@openboard/contract";
import type { Jobs } from "@openboard/ports";
import { call, makeApp, NOW } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";

async function expectSecretsAbsent(store: ReturnType<typeof openSnapshotStore>, values: string[]) {
  const rows = await store.databaseRows();
  expect(rows.webhook_secrets).toHaveLength(2);
  const columns = Object.values(rows).flatMap((table) => table.flatMap((row) => Object.values(row)));
  const stored = columns.map((value) =>
    value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : String(JSON.stringify(value)),
  );
  for (const value of values) {
    const encoded = Buffer.from(value).toString("base64");
    expect(stored.some((column) => column.includes(value) || column.includes(encoded))).toBe(false);
  }
}

test("stores signing secrets and unsigned receiver headers encrypted and disables both hooks with the wrong key", async () => {
  let now = NOW;
  const store = openSnapshotStore(() => now);
  const key = new Uint8Array(32).fill(5);
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const requests: Request[] = [];
  const app = makeApp({
    store,
    now: () => now,
    secretKey: key,
    webhookCustomSigning: true,
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
  const authorization = "Bearer receiver fixture";
  const create = async (name: string, extra = {}) => {
    const response = await call(app, "POST", "/x/webhooks", {
      name,
      url: `http://127.0.0.1:9000/${name}`,
      filter: { tail: "dev", types: ["message.posted"] },
      ...extra,
    });
    expect(response.status).toBe(201);
    return (await response.json()) as OutputOf<typeof createWebhook>;
  };
  const postAndDeliver = async () => {
    now++;
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "deliver me" })).status).toBe(201);
    await Promise.all(wakes.map((wake) => wake()));
  };

  try {
    const signed = await create("signed");
    const unsigned = await create("unsigned", { signing: { preset: "none" }, headers: { authorization } });
    if (!signed.secret) throw new Error("missing generated signing secret");
    expect(unsigned.secret).toBeUndefined();
    await postAndDeliver();
    expect(requests).toHaveLength(2);
    expect(requests.find(({ url }) => url.endsWith("/signed"))?.headers.has("webhook-signature")).toBe(true);
    expect(requests.find(({ url }) => url.endsWith("/unsigned"))?.headers.get("authorization") === authorization).toBe(
      true,
    );

    // Simulate opening the same database under a different master key.
    key.fill(6);
    await postAndDeliver();
    await postAndDeliver();
    expect(requests).toHaveLength(2);
    for (const { webhook } of [signed, unsigned]) {
      const route = `/x/webhooks/${webhook.id}`;
      expect(await (await call(app, "GET", route)).json()).toMatchObject({
        enabled: false,
        disabledReason: "secret_unreadable",
      });
      expect(await (await call(app, "GET", `${route}/deliveries`)).json()).toMatchObject({
        deliveries: [
          { state: "dead", attempt: 1, lastStatus: null, lastError: "unreachable" },
          { state: "done", attempt: 1, lastStatus: 204 },
        ],
      });
    }

    await expectSecretsAbsent(store, [signed.secret, signed.secret.slice("whsec_".length), authorization]);
  } finally {
    await app.close();
  }
});

test("a DNS deadline cannot mask an unreadable webhook key", async () => {
  const key = new Uint8Array(32).fill(5);
  const pendingDns = Promise.withResolvers<string[]>();
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  let dnsStalls = false;
  let expire: (() => void) | undefined;
  let sends = 0;
  const app = makeApp({
    secretKey: key,
    resolveHost: async () => {
      if (!dnsStalls) return ["127.0.0.1"];
      expire?.();
      return pendingDns.promise;
    },
    schedule: (delay, callback) => {
      if (delay === 10_000) expire = callback;
      return () => {};
    },
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async () => {
      sends++;
      return new Response(null, { status: 204 });
    },
  });
  try {
    const created = await call(app, "POST", "/x/webhooks", {
      name: "slow-dns",
      url: "http://localhost:9000/hook",
      filter: { tail: "dev", types: ["message.posted"] },
    });
    expect(created.status).toBe(201);
    const { webhook } = (await created.json()) as OutputOf<typeof createWebhook>;
    key.fill(6);
    dnsStalls = true;
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "deliver me" })).status).toBe(201);
    await Promise.all(wakes.map((wake) => wake()));
    expect(sends).toBe(0);
    expect(await (await call(app, "GET", `/x/webhooks/${webhook.id}`)).json()).toMatchObject({
      enabled: false,
      disabledReason: "secret_unreadable",
    });
  } finally {
    pendingDns.resolve(["127.0.0.1"]);
    await app.close();
  }
});

test("creation of webhook and inbound credentials requires a configured key", async () => {
  const app = makeApp();
  try {
    const webhook = { name: "receiver", url: "http://127.0.0.1:9000/hook", filter: { tail: "dev" } };
    const inbound = {
      name: "receiver",
      can: { "dev/": ["read", "post", "label"] },
      verify: { preset: "ts-id-body", signatureHeader: "X-Sig", timestampHeader: "X-Time", idHeader: "X-Id" },
      thread: { from: "{{body.externalRef}}", pattern: "^ob:(\\d+)$" },
      rules: [{ when: { "body.action": "done" }, do: [{ reply: "Finished" }] }],
    };
    for (const [route, body] of [
      ["/x/webhooks", webhook],
      ["/x/inbound", inbound],
    ] as const) {
      const response = await call(app, "POST", route, body);
      expect(response.status, route).toBe(501);
      expect(await response.json()).toMatchObject({
        error: { code: "not_supported", hint: "Set OPENBOARD_SECRET_KEY." },
      });
    }
  } finally {
    await app.close();
  }
});
