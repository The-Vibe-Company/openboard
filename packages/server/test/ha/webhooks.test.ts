import { expect, test } from "bun:test";
import type { createWebhook, listWebhookDeliveries, OutputOf, postMessage, readEvents } from "@openboard/contract";
import { type Jobs, type Store, WEBHOOK_DELIVERY_JOB } from "@openboard/ports";
import { type App, createApp, type Deps } from "../../src/index.ts";
import { signIn } from "../isolation/seed.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";
import { postgresTestUrl, webhookStressEnabled } from "../support/env.ts";
import { webhookReceiver } from "../support/receiver.ts";

const board = "/api/hooks/main";

async function answer<T>(request: Promise<Response>, status: number): Promise<T> {
  const response = await request;
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

function instance(
  db: Store,
  instanceId: string,
  now: () => number,
  randomBytes: Deps["randomBytes"],
  error: Deps["log"]["error"],
  webhookFetch: NonNullable<Deps["webhookFetch"]>,
) {
  let wake: Parameters<Jobs["watch"]>[2] | undefined;
  let request = 0;
  const app = createApp(
    {
      mode: "hosted",
      localOwner: LOCAL_OWNER,
      publicUrl: PUBLIC_URL,
      instanceId,
      signup: "open",
      secretKey: new Uint8Array(32).fill(12),
    },
    {
      store: db,
      blobs: db.blobs,
      jobs: {
        ...db.jobs,
        watch: (kinds, _schedule, run) => {
          if (kinds.includes(WEBHOOK_DELIVERY_JOB)) wake = run;
          return () => {};
        },
      },
    },
    {
      now,
      randomBytes,
      requestId: () => `${instanceId}-${++request}`,
      schedule: () => () => {},
      log: { info() {}, error },
      resolveHost: async () => ["8.8.8.8"],
      webhookFetch,
    },
  );
  return {
    app,
    run: () => {
      if (!wake) throw new Error("missing webhook runner");
      return wake();
    },
  };
}

async function fixture() {
  let time = NOW;
  let drawn = 0;
  const now = () => time;
  const store = openStore(now);
  const peer = store.sibling?.();
  if (!peer) throw new Error("missing second Postgres store");
  const { headers } = await signIn(store, "hook-owner", "a");
  const receiver = webhookReceiver();
  const errors: Array<{ message: string; instanceId: unknown }> = [];
  const error: Deps["log"]["error"] = (message, fields) => {
    errors.push({ message, instanceId: fields?.instanceId });
  };
  const randomBytes = (size: number) => new Uint8Array(size).fill(++drawn);

  function send(app: App, path: string, body?: unknown) {
    return app.fetch(
      new Request(PUBLIC_URL + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { ...headers, "content-type": "application/json" },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    );
  }
  return {
    instance: (db: Store, name: string, fetch: NonNullable<Deps["webhookFetch"]>) =>
      instance(db, name, now, randomBytes, error, fetch),
    store,
    peer,
    receiver,
    errors,
    send,
    advance: (ms: number) => {
      time += ms;
    },
    async subscribe(app: App) {
      await answer(send(app, "/api/x/orgs", { slug: "hooks", name: "Hooks" }), 201);
      const { webhook } = await answer<OutputOf<typeof createWebhook>>(
        send(app, `${board}/x/webhooks`, {
          name: "ha",
          url: "https://receiver.example.com/hooks",
          filter: { tail: "dev", types: ["message.posted"] },
        }),
        201,
      );
      return webhook.id;
    },
    async post(app: App, re?: string) {
      const { message } = await answer<OutputOf<typeof postMessage>>(
        send(app, `${board}/messages`, {
          ...(re ? { re } : { channel: "dev" }),
          text: "delivery",
        }),
        201,
      );
      return message.id;
    },
    async deliveries(app: App, hook: string) {
      const { deliveries } = await answer<OutputOf<typeof listWebhookDeliveries>>(
        send(app, `${board}/x/webhooks/${hook}/deliveries?limit=200`),
        200,
      );
      return deliveries;
    },
  };
}

async function expectOrderedDelivery(threadCount: number, eventsPerThread: number) {
  const f = await fixture();
  const eventCount = threadCount * eventsPerThread;
  const sendReplies = Promise.withResolvers<void>();
  const startWorker = (store: Store, name: string) => {
    const started = Promise.withResolvers<void>();
    const worker = f.instance(store, name, async (request) => {
      started.resolve();
      await sendReplies.promise;
      return f.receiver.fetch(request);
    });
    return { ...worker, started: started.promise };
  };
  const one = startWorker(f.store, "one");
  const two = startWorker(f.peer, "two");
  const workers = [one, two];
  try {
    const hook = await f.subscribe(one.app);
    const postPair = () => Promise.all([f.post(one.app), f.post(two.app)]);
    const threads = [await postPair()];
    const running = workers.map((worker) => worker.run());
    try {
      // Each runner is holding a different thread head while both apps write more events.
      const ready = Promise.all(workers.map(({ started }) => started)).then(() => true);
      expect(await Promise.race([ready, ...running.map((run) => run.then(() => false))])).toBe(true);
      for (let pair = 1; pair < threadCount / 2; pair++) threads.push(await postPair());
      for (let reply = 1; reply < eventsPerThread; reply++) {
        for (const [first, second] of threads) {
          await Promise.all([f.post(one.app, first), f.post(two.app, second)]);
        }
      }
    } finally {
      sendReplies.resolve();
      await Promise.all(running);
    }
    expect(await Promise.all(workers.map((worker) => worker.run()))).toEqual([null, null]);

    const deliveries = await f.deliveries(two.app, hook);
    expect(deliveries).toHaveLength(eventCount);
    expect(deliveries.every(({ state, attempt }) => state === "done" && attempt === 1)).toBe(true);
    f.advance(30_000);
    expect(await Promise.all(workers.map((worker) => worker.run()))).toEqual([null, null]);

    const { posts, applied } = f.receiver;
    expect(posts).toHaveLength(eventCount);
    expect(applied.size).toBe(eventCount);
    expect(posts.every(({ attempt }) => attempt === 1)).toBe(true);
    for (const thread of threads.flat()) {
      const { events } = await answer<OutputOf<typeof readEvents>>(
        f.send(two.app, `${board}/events?re=${thread}&last=${eventsPerThread}`),
        200,
      );
      expect(events).toHaveLength(eventsPerThread);
      expect(posts.filter((post) => post.thread === thread).map(({ cursor }) => cursor)).toEqual(
        events.map(({ cursor }) => cursor),
      );
    }
    expect(f.errors).toEqual([]);
  } finally {
    await Promise.all(workers.map(({ app }) => app.close()));
  }
}

if (postgresTestUrl() && webhookStressEnabled()) {
  test("two hosted dispatchers deliver 200 events once in log order across 20 threads", () =>
    expectOrderedDelivery(20, 10));
}

if (postgresTestUrl() && !webhookStressEnabled()) {
  test("two hosted dispatchers deliver 12 events once in log order across 4 threads", () =>
    expectOrderedDelivery(4, 3));

  test("an accepted delivery is retried with the same webhook-id after a crashed worker's 30 s lease", async () => {
    const f = await fixture();
    let lostWorker = false;
    const workerStore: Store = {
      ...f.store,
      board(scope) {
        const board = f.store.board(scope);
        const write: typeof board.write = async (...args) => {
          if (lostWorker) throw new Error("worker lost before completing delivery");
          return board.write(...args);
        };
        return new Proxy(board, {
          get(target, key, receiver) {
            return key === "write" ? write : Reflect.get(target, key, receiver);
          },
        });
      },
    };
    const one = f.instance(workerStore, "crashed", async (request) => {
      const response = await f.receiver.fetch(request);
      // The receiver answered, but the worker never records its result.
      lostWorker = true;
      return response;
    });
    const two = f.instance(f.peer, "survivor", f.receiver.fetch);
    try {
      const hook = await f.subscribe(one.app);
      await f.post(one.app);
      await one.run();
      const { posts, applied } = f.receiver;
      expect(posts).toHaveLength(1);
      const [first] = posts;
      if (!first) throw new Error("missing accepted delivery");
      expect(first.attempt).toBe(1);
      expect(await f.deliveries(two.app, hook)).toMatchObject([{ id: first.id, state: "sending", attempt: 1 }]);

      f.advance(29_999);
      expect(await two.run()).toBe(NOW + 30_000);
      expect(posts).toHaveLength(1);

      f.advance(1);
      expect(await two.run()).toBeNull();
      expect(posts).toEqual([first, { ...first, attempt: 2 }]);
      expect([...applied.values()]).toEqual([first]);
      expect(await f.deliveries(two.app, hook)).toMatchObject([
        { id: first.id, state: "done", attempt: 2, lastStatus: 204 },
      ]);
      expect(f.errors).toEqual([{ message: "job failed", instanceId: "crashed" }]);
    } finally {
      await Promise.all([one.app.close(), two.app.close()]);
    }
  });
}
