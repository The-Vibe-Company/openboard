import { expect, test } from "bun:test";
import type { createWebhook, listWebhookDeliveries, OutputOf, postMessage } from "@openboard/contract";
import { JOB_LEASE_MS, type Jobs, type Store, WEBHOOK_DELIVERY_JOB } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { call, makeApp, NOW } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const kinds = [WEBHOOK_DELIVERY_JOB];

async function answer<T>(request: Promise<Response>, status: number): Promise<T> {
  const response = await request;
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

async function localScope(store: Store) {
  const keys = await store.platform().findBoard("local", "main");
  if (!keys) throw new Error("missing local board");
  return testScope(keys);
}

function fixture(receive: (message: string, attempt: number) => number | Promise<number> = () => 204, claimDelay = 0) {
  let time = NOW;
  const now = () => time;
  const store = openStore(now);
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const timeouts: number[] = [];
  const app = makeApp({
    store: {
      ...store,
      jobs: {
        ...store.jobs,
        async claim(...args) {
          const claim = await store.jobs.claim(...args);
          if (claim.job) time += claimDelay;
          return claim;
        },
      },
    },
    now,
    secretKey: new Uint8Array(32).fill(12),
    schedule: (delay) => {
      timeouts.push(delay);
      return () => {};
    },
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      const { subject, delivery } = (await request.json()) as {
        subject: { message: string };
        delivery: { attempt: number };
      };
      return new Response(null, { status: await receive(subject.message, delivery.attempt) });
    },
  });
  return {
    app,
    store,
    wakes,
    timeouts,
    now,
    advance(ms: number) {
      time += ms;
    },
    run() {
      const [wake] = wakes;
      if (!wake) throw new Error("missing job runner");
      return wake();
    },
    async subscribe() {
      return (
        await answer<OutputOf<typeof createWebhook>>(
          call(app, "POST", "/x/webhooks", {
            name: "ordered",
            url: "http://127.0.0.1:9000/hook",
            filter: { tail: "dev", types: ["message.posted"] },
          }),
          201,
        )
      ).webhook.id;
    },
    async post(re?: string) {
      return (
        await answer<OutputOf<typeof postMessage>>(
          call(app, "POST", "/messages", { ...(re ? { re } : { channel: "dev" }), text: "delivery" }),
          201,
        )
      ).message.id;
    },
    async deliveries(webhook: string) {
      return (
        await answer<OutputOf<typeof listWebhookDeliveries>>(call(app, "GET", `/x/webhooks/${webhook}/deliveries`), 200)
      ).deliveries;
    },
    scope: () => localScope(store),
  };
}

for (const terminal of [204, 400]) {
  test(`a retry holds its lane until the first delivery returns ${terminal}`, async () => {
    let first: string;
    const calls: Array<[string, number]> = [];
    const f = fixture((message, attempt) => {
      calls.push([message, attempt]);
      return message === first ? (attempt <= 2 ? 503 : terminal) : 204;
    });
    try {
      const webhook = await f.subscribe();
      first = await f.post();
      const second = await f.post(first);
      const third = await f.post(first);
      const other = await f.post();
      const otherReply = await f.post(other);
      expect(await f.run()).toEqual(NOW + 10_000);
      expect(calls).toEqual([
        [first, 1],
        [other, 1],
        [otherReply, 1],
      ]);
      f.advance(10_000);
      expect(await f.run()).toEqual(NOW + 40_000);
      expect(calls.slice(3)).toEqual([[first, 2]]);
      f.advance(30_000);
      await f.run();
      expect(calls.slice(4)).toEqual([
        [first, 3],
        [second, 1],
        [third, 1],
      ]);
      const rows = await f.deliveries(webhook);
      expect(rows.find((row) => row.event === Number(first))).toMatchObject({
        state: terminal === 204 ? "done" : "dead",
        attempt: 3,
      });
      expect(f.app.logged).toEqual([]);
    } finally {
      await f.app.close();
    }
  });
}

test("a second worker skips a held lane and sends another thread", async () => {
  const held = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<number>();
  let first: string;
  const calls: string[] = [];
  const f = fixture((message) => {
    calls.push(message);
    if (message !== first) return 204;
    held.resolve();
    return finish.promise;
  });
  try {
    const webhook = await f.subscribe();
    first = await f.post();
    const reply = await f.post(first);
    const other = await f.post();
    const [primary, peer] = f.wakes;
    if (!primary) throw new Error("missing job runner");
    const running = primary();
    await held.promise;
    if (peer) {
      expect(await peer()).toBe(NOW + JOB_LEASE_MS);
      expect(calls).toEqual([first, other]);
    } else {
      const lease = { instanceId: "other-worker", claimedAt: NOW };
      const claim = await f.store.jobs.claim(kinds, lease);
      expect(claim.job).not.toBeNull();
      if (!claim.job) throw new Error("missing other lane");
      const board = f.store.board(await f.scope());
      const payload = await board.write((writer) => writer.readJob(claim.job.id, lease, NOW));
      expect(payload?.id).toBe((await f.deliveries(webhook)).find(({ event }) => event === Number(other))?.id);
      expect(await f.store.jobs.claim(kinds, lease)).toEqual({ job: null, nextDue: NOW + JOB_LEASE_MS });
      await f.store.jobs.release(lease.instanceId, NOW);
    }
    finish.resolve(204);
    await running;
    expect(calls).toEqual(peer ? [first, other, reply] : [first, reply, other]);
  } finally {
    finish.resolve(204);
    await f.app.close();
  }
});

test("the fifth worker waits for a subscription slot", async () => {
  const f = fixture();
  try {
    await f.subscribe();
    for (let i = 0; i < 5; i++) await f.post();
    const peer = f.store.sibling?.() ?? f.store;
    const scope = await f.scope();
    const claims = await Promise.all(
      Array.from({ length: 5 }, async (_, index) => {
        const store = index % 2 === 0 ? f.store : peer;
        const lease = { instanceId: `worker-${index}`, claimedAt: NOW };
        const { job } = await store.jobs.claim(kinds, lease);
        if (!job) throw new Error("missing lane head");
        const board = store.board(scope);
        const id = (await board.write((writer) => writer.readJob(job.id, lease, NOW)))?.id;
        if (typeof id !== "string") throw new Error("missing delivery ID");
        const begin = () =>
          board.write((writer) => writer.beginWebhookAttempt(id, lease.instanceId, NOW, NOW + JOB_LEASE_MS));
        return { board, id, begin, store, lease };
      }),
    );
    const attempts = await Promise.all(claims.map(({ begin }) => begin()));
    expect(attempts.filter((attempt) => attempt && "attempt" in attempt)).toHaveLength(4);
    const started = claims[attempts.findIndex((attempt) => attempt && "attempt" in attempt)];
    const deferred = claims[attempts.findIndex((attempt) => attempt && "deferred" in attempt)];
    if (!started || !deferred) throw new Error("missing started or deferred attempt");
    await deferred.store.jobs.release(deferred.lease.instanceId, NOW);
    expect(await peer.jobs.claim(kinds, { instanceId: "waiting", claimedAt: NOW })).toEqual({
      job: null,
      nextDue: NOW + JOB_LEASE_MS,
    });
    expect(
      await started.board.write((writer) =>
        writer.finishWebhookAttempt(started.id, 1, { state: "done", now: NOW, status: 204, error: null }),
      ),
    ).toBe(true);
    const waiting = { instanceId: "waiting", claimedAt: NOW };
    const { job } = await peer.jobs.claim(kinds, waiting);
    if (!job) throw new Error("slot did not reopen");
    expect(await deferred.board.write((writer) => writer.readJob(job.id, waiting, NOW))).toEqual({ id: deferred.id });
  } finally {
    await f.app.close();
  }
});

test("a slow claim leaves only the rest of its lease to send", async () => {
  const f = fixture(() => 204, 25_000);
  try {
    const webhook = await f.subscribe();
    const message = await f.post();
    await f.run();
    expect(f.timeouts).toEqual([5_000]);
    expect((await f.deliveries(webhook)).find(({ event }) => event === Number(message))).toMatchObject({
      state: "done",
      attempt: 1,
    });
  } finally {
    await f.app.close();
  }
});

test("the job pick keeps threadless jobs in their own lane", async () => {
  const f = fixture();
  try {
    const webhook = await f.subscribe();
    const board = f.store.board(await f.scope());
    const [record] = await board.webhooks();
    if (!record) throw new Error("missing subscription");
    // Pings give the fixture threadless delivery rows without changing the v1 event payload.
    await board.write(async (writer) => {
      for (const [index, id] of ["threadless-first", "threadless-second"].entries()) {
        expect(await writer.beginWebhookPing(record, id, NOW + index)).not.toBeNull();
        const due = index === 0 ? NOW + 10_000 : NOW;
        await writer.finishWebhookAttempt(id, 1, { state: "dead", now: NOW, status: 503, error: null });
        expect(await writer.retryWebhookDelivery(webhook, id, due)).toBe("queued");
        await writer.enqueue(WEBHOOK_DELIVERY_JOB, due, { id });
      }
    });
    const threaded = await f.post();
    const reply = await f.post(threaded);
    const deliveries = await f.deliveries(webhook);
    const pickMessage = async (message: string) => {
      const row = deliveries.find(({ event }) => event === Number(message));
      if (!row) throw new Error("missing message delivery");
      await pickAndFinish(row.id);
    };
    const pickAndFinish = async (id: string) => {
      const lease = { instanceId: "worker", claimedAt: f.now() };
      const { job } = await f.store.jobs.claim(kinds, lease);
      if (!job) throw new Error("missing delivery job");
      await board.write(async (writer) => {
        expect(await writer.takeJob(job.id, lease, f.now())).toEqual({ id });
        // Settle the fixture's queued row at the job layer, without serializing a v1 payload.
        const attempt = await writer.beginWebhookAttempt(id, lease.instanceId, f.now());
        expect(attempt).toMatchObject({ attempt: 1 });
        expect(
          await writer.finishWebhookAttempt(id, 1, { state: "done", now: f.now(), status: 204, error: null }),
        ).toBe(true);
      });
    };
    await pickMessage(threaded);
    await pickMessage(reply);
    expect(await f.store.jobs.claim(kinds, { instanceId: "worker", claimedAt: NOW })).toEqual({
      job: null,
      nextDue: NOW + 10_000,
    });
    f.advance(10_000);
    await pickAndFinish("threadless-first");
    await pickAndFinish("threadless-second");
  } finally {
    await f.app.close();
  }
});
