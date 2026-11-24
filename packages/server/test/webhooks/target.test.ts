import { expect, test } from "bun:test";
import type { Jobs } from "@openboard/ports";
import type { Deps } from "../../src/deps.ts";
import { sendWebhook } from "../../src/webhooks/send.ts";
import { signIn } from "../isolation/seed.ts";
import { call, makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";

const receiver = "https://receiver.example/hook?from=board";
const publicAddress = "8.8.8.8";
const boardOrigin = "https://board.example";
const spec = { name: "hook", filter: { tail: "dev", types: ["labels.changed"] } };

async function hosted(options: Parameters<typeof makeApp>[0] = {}) {
  const store = openSnapshotStore(options.now ?? (() => NOW));
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const app = makeApp({
    ...options,
    mode: "hosted",
    publicUrl: boardOrigin,
    store,
    secretKey: new Uint8Array(32).fill(12),
    signup: "open",
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
  });
  try {
    const { headers } = await signIn(store, "hook-owner", "a");
    const send = (path: string, body: unknown) =>
      app.fetch(
        new Request(`${boardOrigin}/api${path}`, {
          method: "POST",
          headers: { ...headers, origin: boardOrigin, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect((await send("/x/orgs", { slug: "hooks", name: "Hooks" })).status).toBe(201);
    return {
      close: app.close,
      create: (url: string, extra = {}) => send("/hooks/main/x/webhooks", { ...spec, url, ...extra }),
      async deliver() {
        const posted = await send("/hooks/main/messages", { channel: "dev", text: "a thread" });
        expect(posted.status).toBe(201);
        const { message } = (await posted.json()) as { message: { id: string } };
        expect((await send(`/hooks/main/messages/${message.id}/labels`, { set: { status: "ready" } })).status).toBe(
          200,
        );
        await Promise.all(wakes.map((wake) => wake()));
      },
      async wake() {
        await Promise.all(wakes.map((wake) => wake()));
      },
      async deliveries() {
        const keys = await store.platform().findBoard("hooks", "main");
        if (!keys) throw new Error("missing board");
        return (await store.tenantRows(keys)).rows.webhook_deliveries?.map((row) => ({
          ...row,
          last_status: Number(row.last_status),
        }));
      },
    };
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function invalid(response: Response, reason: string) {
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "invalid_url", reason } });
}

test("hosted creation refuses unsafe destinations and mixed DNS answers with reasons", async () => {
  const app = await hosted({ resolveHost: async () => [publicAddress, "10.0.0.5"] });
  try {
    for (const [url, reason] of [
      ["https://10.0.0.5/", "address"],
      ["https://169.254.169.254/", "address"],
      ["https://[::1]/", "address"],
      ["https://[::ffff:127.0.0.1]/", "address"],
      ["https://100.64.0.1/", "address"],
      ["https://x.internal/", "reserved_host"],
      ["https://x.railway.internal/", "reserved_host"],
      ["https://x.local/", "reserved_host"],
      ["https://board.example./", "service_host"],
      ["http://receiver.example/", "scheme"],
      ["https://receiver.example:8443/", "port"],
      ["https://user:pass@receiver.example/", "credentials"],
      [receiver, "address"],
    ] as const) {
      await invalid(await app.create(url), reason);
    }
  } finally {
    await app.close();
  }
});

test("delivery uses the checked address and verified TLS identity, never follows a 3xx, and rechecks DNS", async () => {
  let addresses = [publicAddress];
  const attempts: Parameters<NonNullable<Deps["webhookFetch"]>>[] = [];
  const app = await hosted({
    resolveHost: async (host) => {
      expect(host).toBe("receiver.example");
      return addresses;
    },
    webhookFetch: async (request, options) => {
      attempts.push([request, options]);
      return new Response(null, { status: 302, headers: { location: "https://other.example/" } });
    },
  });
  try {
    expect((await app.create(receiver)).status).toBe(201);
    await app.deliver();
    expect(attempts).toHaveLength(1);
    const attempt = attempts[0];
    if (!attempt) throw new Error("no delivery attempt");
    const [request, options] = attempt;
    expect(request.url).toBe(`https://${publicAddress}/hook?from=board`);
    expect(request.headers.get("host")).toBe("receiver.example");
    expect(options).toMatchObject({
      redirect: "manual",
      proxy: false,
      keepalive: false,
      tls: { serverName: "receiver.example", rejectUnauthorized: true },
    });
    expect(await app.deliveries()).toContainEqual(expect.objectContaining({ last_status: 302 }));
    addresses = ["10.0.0.5"];
    await app.deliver();
    expect(attempts).toHaveLength(1);
    expect(await app.deliveries()).toContainEqual(expect.objectContaining({ last_error: "invalid_url" }));
  } finally {
    await app.close();
  }
});

test("retries a failed DNS lookup before sending to a checked address", async () => {
  let now = NOW;
  let dnsAvailable = true;
  const requests: Request[] = [];
  const app = await hosted({
    now: () => now,
    resolveHost: async () => {
      if (!dnsAvailable) throw new Error("DNS lookup failed");
      return [publicAddress];
    },
    webhookFetch: async (request) => {
      requests.push(request);
      return new Response(null, { status: 204 });
    },
  });
  try {
    expect((await app.create(receiver)).status).toBe(201);
    dnsAvailable = false;
    await app.deliver();
    expect(requests).toHaveLength(0);
    expect(await app.deliveries()).toContainEqual(
      expect.objectContaining({ state: "pending", last_error: "request_failed" }),
    );
    dnsAvailable = true;
    now += 10_000;
    await app.wake();
    expect(requests.map((request) => request.url)).toEqual([`https://${publicAddress}/hook?from=board`]);
    expect(await app.deliveries()).toContainEqual(expect.objectContaining({ state: "done", last_status: 204 }));
  } finally {
    await app.close();
  }
});

test("only operator configuration can allow an exact private host and extra HTTPS ports", async () => {
  const app = await hosted({
    resolveHost: async () => ["10.0.0.5"],
    webhookTargets: { hosts: ["hooks.corp"], ports: [8443] },
  });
  try {
    await invalid(await app.create("https://other.hooks.corp:8443/"), "address");
    await invalid(await app.create("https://hooks.corp:9443/"), "port");
    const override = await app.create("https://other.example/", { webhookTargets: { hosts: ["other.example"] } });
    expect(override.status).toBe(400);
    expect((await app.create("https://hooks.corp:8443/")).status).toBe(201);
  } finally {
    await app.close();
  }
});

test("local HTTP works on loopback and private targets are refused", async () => {
  const app = makeApp({
    secretKey: new Uint8Array(32),
    resolveHost: async () => ["::1", "127.0.0.1"],
    schedule: () => () => {},
  });
  try {
    const create = (url: string) => call(app, "POST", "/x/webhooks", { ...spec, url });
    await invalid(await create("https://192.168.1.1/"), "address");
    await invalid(await create("http://192.168.1.1/"), "scheme");
    expect((await create("http://localhost:9000/")).status).toBe(201);
  } finally {
    await app.close();
  }
});

const local = { mode: "local" as const, publicUrl: PUBLIC_URL };
const payload = () => ({ headers: new Headers(), body: "{}" });
const noTimer = () => () => {};

test("tries the next validated loopback address only after a refused connection", async () => {
  const attempts: string[] = [];
  const result = await sendWebhook(
    "http://localhost:9000/",
    local,
    {
      resolveHost: async () => ["::1", "127.0.0.1"],
      webhookFetch: async (request) => {
        attempts.push(request.url);
        if (attempts.length === 1) throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
        expect(await request.text()).toBe("{}");
        return new Response(null, { status: 204 });
      },
      schedule: noTimer,
    },
    payload(),
  );
  expect(result).toEqual({ status: 204, error: null, retryAfter: null });
  expect(attempts).toEqual(["http://[::1]:9000/", "http://127.0.0.1:9000/"]);
});

test("a webhook creation DNS lookup has a deadline", async () => {
  const scheduled = Promise.withResolvers<() => void>();
  const dns = Promise.withResolvers<readonly string[]>();
  let cancelled = false;
  const app = makeApp({
    secretKey: new Uint8Array(32),
    resolveHost: () => dns.promise,
    schedule: (ms, run) => {
      expect(ms).toBe(10_000);
      scheduled.resolve(run);
      return () => {
        cancelled = true;
      };
    },
  });
  try {
    const creation = call(app, "POST", "/x/webhooks", { ...spec, url: receiver });
    (await scheduled.promise)();
    await invalid(await creation, "dns");
    expect(cancelled).toBe(true);
  } finally {
    dns.resolve([publicAddress]);
    await app.close();
  }
});

test("reads at most 8 KB from a byte stream and cancels unbounded default streams", async () => {
  let bytesRead = 0;
  let cancelled = false;
  const bytes = new ReadableStream(
    {
      type: "bytes",
      pull(controller: ReadableByteStreamController) {
        const read = controller.byobRequest;
        if (!read?.view) throw new Error("missing bounded read");
        bytesRead += read.view.byteLength;
        read.respond(read.view.byteLength);
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const send = (body: ReadableStream) =>
    sendWebhook(
      "http://127.0.0.1:9000/",
      local,
      {
        webhookFetch: async () => new Response(body),
        schedule: noTimer,
      },
      payload(),
    );
  expect(await send(bytes)).toEqual({ status: 200, error: null, retryAfter: null });
  expect(bytesRead).toBe(8192);
  expect(cancelled).toBe(true);

  let unboundedCancelled = false;
  const unbounded = new ReadableStream(
    {
      pull() {
        throw new Error("must not read unbounded chunks");
      },
      cancel() {
        unboundedCancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  expect(await send(unbounded)).toEqual({ status: 200, error: null, retryAfter: null });
  expect(unboundedCancelled).toBe(true);
});
