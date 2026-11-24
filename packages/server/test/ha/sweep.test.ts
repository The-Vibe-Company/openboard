import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { createInbound, listWebhookDeliveries, Message, OutputOf } from "@openboard/contract";
import type { JobSchedule, Store } from "@openboard/ports";
import { seedWebhook, testScope } from "@openboard/ports/testkit";
import { createApp, type JobHandler } from "../../src/index.ts";
import { call, LOCAL_OWNER, NOW, OWNER, PUBLIC_URL } from "../support/app.ts";
import { openSnapshotStore, openStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";

const day = 86_400_000;
const due = NOW + 8 * day;
const key = new Uint8Array(32).fill(12);
const signingSecret = "operational retention signing fixture";

function fakeClock(instances: number) {
  let now = NOW;
  const timers = new Map<() => void | Promise<void>, number>();
  const armed = Promise.withResolvers<void>();
  const schedule: JobSchedule = (delay, run) => {
    timers.set(run, now + delay);
    if (timers.size === instances) armed.resolve();
    return () => timers.delete(run);
  };
  return {
    now: () => now,
    schedule,
    timers,
    armed: armed.promise,
    async advance(at: number) {
      now = at;
      const callbacks = [...timers].filter(([, time]) => time <= now);
      await Promise.all(
        callbacks.map(async ([run]) => {
          timers.delete(run);
          await run();
        }),
      );
    },
  };
}

function runner(
  store: Store,
  instanceId: string,
  clock: ReturnType<typeof fakeClock>,
  polls: string[],
  sweeps: string[],
  run: JobHandler = async () => {},
) {
  const platform = store.platform();
  let request = 0;
  return createApp(
    {
      mode: "local",
      instanceId,
      publicUrl: PUBLIC_URL,
      localOwner: LOCAL_OWNER,
      localOwnerTokenHash: OWNER.hash,
      secretKey: key,
    },
    {
      blobs: store.blobs,
      store: {
        ...store,
        platform: () =>
          new Proxy(platform, {
            get(target, property, receiver) {
              if (property !== "sweepExpired") return Reflect.get(target, property, receiver);
              return async (now: number) => {
                await target.sweepExpired(now);
                sweeps.push(instanceId);
              };
            },
          }),
      },
      jobs: {
        ...store.jobs,
        claim(kinds, lease) {
          polls.push(instanceId);
          return store.jobs.claim(kinds, lease);
        },
      },
    },
    {
      now: clock.now,
      schedule: clock.schedule,
      log: {
        info() {},
        error(message) {
          throw new Error(message);
        },
      },
      requestId: () => `${instanceId}-${++request}`,
      randomBytes: (size) => new Uint8Array(size).fill(request),
    },
    { "fixture-work": run },
  );
}

async function prepareReplay(app: ReturnType<typeof runner>, now: () => number) {
  const posted = await call(app, "POST", "/messages", { channel: "ops", text: "Run" });
  expect(posted.status).toBe(201);
  const { message } = (await posted.json()) as { message: Message };
  const created = await call(app, "POST", "/x/inbound", {
    name: "retention",
    can: { ops: ["read", "post"] },
    verify: {
      preset: "ts-id-body",
      signatureHeader: "x-sig",
      timestampHeader: "x-ts",
      idHeader: "x-id",
      secret: signingSecret,
    },
    thread: { from: "{{body.ref}}", pattern: "^ob:(\\d+)$" },
    rules: [{ when: {}, do: [{ reply: "Processed" }] }],
  });
  expect(created.status).toBe(201);
  const { inbound } = (await created.json()) as OutputOf<typeof createInbound>;
  async function replay() {
    const body = JSON.stringify({ ref: `ob:${message.id}` });
    const time = String(Math.floor(now() / 1000));
    const id = "same-event";
    const signature = createHmac("sha256", signingSecret).update(`${time}.${id}.${body}`).digest("hex");
    const response = await app.fetch(
      new Request(inbound.url, {
        method: "POST",
        body,
        headers: { "x-sig": `v1=${signature}`, "x-ts": time, "x-id": id },
      }),
    );
    expect(response.status).toBe(200);
    return response.json();
  }
  return { replay, position: Number(message.id) };
}

const hosted = postgresTestUrl() !== undefined;
test(`${hosted ? "Postgres: both runners poll" : "SQLite"} due work sweeps bounded batches and admits a swept inbound replay as new`, async () => {
  const clock = fakeClock(hosted ? 2 : 1);
  const one = openSnapshotStore(clock.now);
  const two = one.sibling?.();
  const keys = await one.platform().findBoard("local", "main");
  if (!keys) throw new Error("local board is missing");
  const board = one.board(testScope(keys));
  const { webhook } = await seedWebhook(board, "aaaaaaaaaaaaaaaa", LOCAL_OWNER);
  const anchor = await one.seedSweep(keys, webhook.id, due);
  const polls: string[] = [];
  const sweeps: string[] = [];
  const next = due + 60_000;
  // Populate the queue before LISTEN so either runner can discover both jobs from storage.
  await board.write(async (writer) => {
    await writer.enqueue("fixture-work", due, {});
    await writer.enqueue("fixture-work", next, {});
  });
  const first = runner(one, "one", clock, polls, sweeps);
  const second = two && runner(two, "two", clock, polls, sweeps);
  try {
    const { replay, position } = await prepareReplay(first, clock.now);
    const original = await replay();
    expect(await replay()).toEqual(original);

    const path = `/x/webhooks/${webhook.id}/deliveries?before=${anchor}`;
    const pageBefore = await call(first, "GET", path);
    expect(pageBefore.status).toBe(200);
    const page = (await pageBefore.json()) as OutputOf<typeof listWebhookDeliveries>;
    expect(page.deliveries.length).toBeGreaterThan(0);
    const before = await one.sweepSnapshot();
    await clock.armed;
    await clock.advance(due - 1);
    expect(await one.sweepSnapshot()).toEqual(before);
    expect(sweeps).toEqual([]);

    await clock.advance(due);
    expect(new Set(polls)).toEqual(new Set(two ? ["one", "two"] : ["one"]));
    expect(sweeps).toHaveLength(1);
    expect(await one.sweepSnapshot()).toEqual({
      deliveries: ["dl_cccccccccccccccc", "done-boundary", "pending-old", "sending-old"],
      matches: ["done-young", "pending-old"],
      sessions: ["live"],
      devices: ["live"],
      invitations: ["accepted-young", "expired-young", "live"],
      // The older 1,001 rows have priority over the expired real delivery.
      backlog: 1,
      inboundTimes: [String(NOW)],
    });
    const pageAfter = await call(first, "GET", path);
    expect(pageAfter.status).toBe(200);
    expect(await pageAfter.json()).toEqual({ deliveries: [], older: null });
    const retry = (id: string) => call(first, "POST", `/x/webhooks/${webhook.id}/deliveries/${id}/retry`);
    expect((await retry("dl_bbbbbbbbbbbbbbbb")).status).toBe(404);
    const requeued = await retry("dl_cccccccccccccccc");
    expect(requeued.status).toBe(200);
    expect(await requeued.json()).toEqual({ id: "dl_cccccccccccccccc" });
    expect(await replay()).toEqual(original);

    await clock.advance(next);
    expect(sweeps).toHaveLength(2);
    expect((await one.sweepSnapshot()).backlog).toBe(0);
    expect((await one.sweepSnapshot()).inboundTimes).toEqual([]);
    const processedAgain = await replay();
    const replies = (await board.thread(position))?.replies ?? [];
    expect(replies).toHaveLength(2);
    expect(original).toEqual({ ok: true, matched: [0], results: [{ reply: replies[0]?.id }] });
    expect(processedAgain).toEqual({ ok: true, matched: [0], results: [{ reply: replies[1]?.id }] });
    expect(await replay()).toEqual(processedAgain);
    // A competing runner may still have armed the last lease expiry before the job finished.
    await clock.advance(next + 60_000);
    expect(sweeps).toHaveLength(2);
    expect(clock.timers.size).toBe(0);
  } finally {
    await Promise.all([first.close(), second?.close()]);
  }
});

test("a continuously active runner sweeps again without another timer wake", async () => {
  const clock = fakeClock(1);
  const store = openStore(clock.now);
  const keys = await store.platform().findBoard("local", "main");
  if (!keys) throw new Error("local board is missing");
  const board = store.board(testScope(keys));
  const sweeps: string[] = [];
  const app = runner(store, "one", clock, [], sweeps, async (_writer, payload) => {
    if (payload.second) await clock.advance(due + 60_000);
  });
  try {
    await board.write(async (writer) => {
      await writer.enqueue("fixture-work", due, {});
      await writer.enqueue("fixture-work", due, { second: true });
    });
    await clock.armed;
    await clock.advance(due);
    expect(sweeps).toEqual(["one", "one"]);
  } finally {
    await app.close();
  }
});
