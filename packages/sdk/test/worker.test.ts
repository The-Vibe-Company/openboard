import { expect, test } from "bun:test";
import { createClient, runWorker } from "../src/index.ts";

const url = "https://board.example/api/acme/main";
const credentials = { epoch: 3, token: "fixture" };
const until = () => new Date(Date.now() + 300_000).toISOString();

function claimed(id = "1") {
  return Response.json({ task: { id, channel: "work" }, claim: { ...credentials, until: until() } });
}

function errorResponse(status: number, code: string) {
  return Response.json({ error: { code, message: code } }, { status });
}

function clock() {
  const timers = new Map<() => void, number>();
  let scheduled = Promise.withResolvers<void>();
  return {
    schedule(callback: () => void, delay: number) {
      timers.set(callback, delay);
      scheduled.resolve();
      scheduled = Promise.withResolvers<void>();
      return () => {
        timers.delete(callback);
      };
    },
    async tick(delay: number) {
      for (;;) {
        const timer = [...timers].find(([, actual]) => actual === delay);
        if (timer) return timer[0]();
        await scheduled.promise;
      }
    },
    pending: () => timers.size,
  };
}

test("claims with queue filters, replies in the thread, and completes with the handler result", async () => {
  const calls: [string, unknown][] = [];
  const client = createClient({
    url,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      calls.push([path, await request.json()]);
      return path.endsWith("/claim") ? claimed() : Response.json({});
    },
  });
  const stats = await runWorker(
    client,
    { channel: "work/", labels: ["kind=build|test"], from: ["ob:user:fixture"], maxTasks: 1 },
    async ({ reply }) => {
      await reply("working");
      return "done";
    },
  );
  expect(calls).toEqual([
    [
      "/api/acme/main/tasks/claim",
      { channel: "work/", lease: 300, wait: 25, label: ["kind=build|test"], from: ["ob:user:fixture"] },
    ],
    ["/api/acme/main/messages", { re: "1", text: "working" }],
    ["/api/acme/main/tasks/1/complete", { ...credentials, result: "done" }],
  ]);
  expect(stats).toEqual({ claimed: 1, completed: 1, failed: 0, released: 0 });
});

test("renews at half the lease while the handler runs and clears the next timer on completion", async () => {
  const timers = clock();
  const finished = Promise.withResolvers<string>();
  let renewals = 0;
  const client = createClient({
    url,
    fetch: async (request) => {
      if (request.url.endsWith("/claim")) return claimed();
      if (request.url.endsWith("/renew")) {
        expect(await request.json()).toEqual({ ...credentials, lease: 60 });
        renewals++;
        if (renewals === 2) finished.resolve("done");
      }
      return Response.json({ until: until() });
    },
  });
  const worker = runWorker(
    client,
    { channel: "work", lease: 60, maxTasks: 1, schedule: timers.schedule },
    () => finished.promise,
  );
  await timers.tick(30_000);
  await timers.tick(30_000);
  expect((await worker).completed).toBe(1);
  expect(timers.pending()).toBe(0);
});

for (const [status, code] of [
  [409, "claim_lost"],
  [401, "unauthorized"],
] as const) {
  test(`lease renewal aborts the handler on ${code}`, async () => {
    const timers = clock();
    const errors: unknown[] = [];
    const client = createClient({
      url,
      fetch: async (request) => {
        if (request.url.endsWith("/claim")) return claimed();
        expect(request.url).toEndWith("/renew");
        return errorResponse(status, code);
      },
    });
    const worker = runWorker(
      client,
      {
        channel: "work",
        renewIntervalMs: 5,
        maxTasks: 1,
        schedule: timers.schedule,
        onError: (_, info) => errors.push(info),
      },
      async ({ signal }) => {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        return "discarded";
      },
    );
    await timers.tick(5);
    expect(await worker).toEqual({ claimed: 1, completed: 0, failed: 0, released: 0 });
    expect(errors).toEqual([{ phase: "renew", taskId: "1" }]);
    expect(timers.pending()).toBe(0);
  });
}

test("fails with the handler error message", async () => {
  const failure = new Error("build failed");
  const client = createClient({
    url,
    fetch: async (request) => {
      if (request.url.endsWith("/claim")) return claimed();
      expect(request.url).toEndWith("/fail");
      expect(await request.json()).toEqual({ ...credentials, reason: failure.message });
      return Response.json({});
    },
  });
  const stats = await runWorker(client, { channel: "work", maxTasks: 1 }, () => {
    throw failure;
  });
  expect(stats.failed).toBe(1);
});

test("runs handlers concurrently and reserves claims within the shared task limit", async () => {
  let claims = 0;
  let active = 0;
  const both = Promise.withResolvers<void>();
  const client = createClient({
    url,
    fetch: async (request) => (request.url.endsWith("/claim") ? claimed(String(++claims)) : Response.json({})),
  });
  const stats = await runWorker(client, { channel: "work", concurrency: 2, maxTasks: 3 }, async () => {
    expect(++active).toBeLessThanOrEqual(2);
    if (active === 2) both.resolve();
    await both.promise;
    active--;
    return { result: "done" };
  });
  expect(claims).toBe(3);
  expect(stats.completed).toBe(3);
});

test("backs off on network and proxy errors, caps the jittered delay, then recovers", async () => {
  const timers = clock();
  const codes: unknown[] = [];
  let claims = 0;
  const client = createClient({
    url,
    fetch: async (request) => {
      if (!request.url.endsWith("/claim")) return Response.json({});
      claims++;
      if (claims === 1) throw new TypeError("connection lost");
      if (claims === 2) return new Response("proxy unavailable", { status: 503 });
      if (claims === 3) return errorResponse(429, "rate_limited");
      return claimed();
    },
  });
  const worker = runWorker(
    client,
    {
      channel: "work",
      maxTasks: 1,
      schedule: timers.schedule,
      random: () => 0,
      backoffMs: { initial: 20, max: 30 },
      onError: (error, { phase }) => {
        expect(phase).toBe("claim");
        codes.push(error);
      },
    },
    () => "done",
  );
  await timers.tick(10);
  await timers.tick(15);
  await timers.tick(15);
  expect((await worker).completed).toBe(1);
  expect(codes).toMatchObject([{ code: "unreachable" }, { status: 503 }, { code: "rate_limited" }]);
  expect(timers.pending()).toBe(0);
});

test("shutdown aborts the handler and a waiting claim, clears renewal, and releases unsettled work", async () => {
  const timers = clock();
  const abort = new AbortController();
  const handling = Promise.withResolvers<void>();
  const polling = Promise.withResolvers<void>();
  let claims = 0;
  const client = createClient({
    url,
    fetch: async (request) => {
      if (request.url.endsWith("/claim")) {
        if (++claims === 1) return claimed();
        polling.resolve();
        return new Promise((_, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        });
      }
      expect(request.url).toEndWith("/release");
      expect(request.signal.aborted).toBe(false);
      expect(await request.json()).toEqual(credentials);
      return Response.json({});
    },
  });
  const worker = runWorker(
    client,
    { channel: "work", concurrency: 2, signal: abort.signal, schedule: timers.schedule },
    async ({ signal }) => {
      handling.resolve();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      throw signal.reason;
    },
  );
  await Promise.all([handling.promise, polling.promise]);
  expect(timers.pending()).toBe(2);
  abort.abort();
  expect(await worker).toEqual({ claimed: 1, completed: 0, failed: 0, released: 1 });
  expect(timers.pending()).toBe(0);
});

test("shutdown cancels claim backoff immediately", async () => {
  const timers = clock();
  const abort = new AbortController();
  const failed = Promise.withResolvers<void>();
  const client = createClient({ url, fetch: async () => errorResponse(503, "unavailable") });
  const worker = runWorker(
    client,
    { channel: "work", signal: abort.signal, schedule: timers.schedule, onError: () => failed.resolve() },
    () => "unexpected",
  );
  await failed.promise;
  expect(timers.pending()).toBe(1);
  abort.abort();
  expect((await worker).claimed).toBe(0);
  expect(timers.pending()).toBe(0);
});
