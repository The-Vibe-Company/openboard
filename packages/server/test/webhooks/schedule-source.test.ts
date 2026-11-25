import { expect, test } from "bun:test";
import type { createSchedule, OutputOf, postMessage } from "@openboard/contract";
import { isoTime } from "@openboard/core";
import type { Jobs } from "@openboard/ports";
import { call, makeApp, NOW } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

const channel = "cron/nightly-deps";
const first = NOW + 60_000;
const day = 86_400_000;

function fixture(failFirst = false) {
  let time = NOW;
  const now = () => time;
  const store = openStore(now);
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const deliveries: { id: string | null; body: unknown }[] = [];
  const app = makeApp({
    store,
    now,
    secretKey: new Uint8Array(32).fill(12),
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      deliveries.push({ id: request.headers.get("webhook-id"), body: await request.json() });
      return new Response(null, { status: failFirst && deliveries.length === 1 ? 503 : 204 });
    },
  });
  return {
    app,
    deliveries,
    async advance(at: number) {
      time = at;
      // Poll both independent runners against the same database and clock on Postgres.
      expect(wakes).toHaveLength(store.sibling ? 2 : 1);
      await Promise.all(wakes.map((wake) => wake()));
      expect(app.logged).toEqual([]);
    },
  };
}

async function createScheduleSource(app: ReturnType<typeof makeApp>) {
  const webhook = await call(app, "POST", "/x/webhooks", {
    name: "nightly",
    url: "http://127.0.0.1:9000/hook",
    filter: { tail: channel, types: ["message.posted"] },
    body: {
      event_type: "openboard",
      client_payload: {
        thread: "{{subject.thread}}",
        schedule: "{{subject.schedule}}",
        delivery: "{{delivery.id}}",
      },
    },
  });
  expect(webhook.status).toBe(201);
  const created = await call(app, "POST", "/schedules", {
    channel,
    text: "nightly sweep",
    every: "1d",
    at: isoTime(first),
  });
  expect(created.status).toBe(201);
  const { schedule } = (await created.json()) as OutputOf<typeof createSchedule>;
  expect(schedule.id).toBe("s1");
}

function delivered(
  delivery: ReturnType<typeof fixture>["deliveries"][number] | undefined,
  schedule: { id: string; n: number } | null,
) {
  if (!delivery) throw new Error("missing delivery");
  expect(delivery.id).toMatch(/^dl_[a-z2-7]{16}$/);
  expect(delivery.body).toEqual({
    event_type: "openboard",
    client_payload: { thread: expect.stringMatching(/^\d+$/), schedule, delivery: delivery.id },
  });
}

test("daily schedule slots deliver once each and a manual post delivers with a null schedule", async () => {
  const { app, deliveries, advance } = fixture();
  try {
    await createScheduleSource(app);
    for (const n of [0, 1]) {
      const slot = first + n * day;
      await advance(slot - 1);
      expect(deliveries).toHaveLength(n);
      await advance(slot);
      expect(deliveries).toHaveLength(n + 1);
      delivered(deliveries[n], { id: "s1", n });
      await advance(slot);
      expect(deliveries).toHaveLength(n + 1);
    }
    expect(deliveries[0]?.id).not.toBe(deliveries[1]?.id);

    const posted = await call(app, "POST", "/messages", { channel, text: "manual sweep" });
    expect(posted.status).toBe(201);
    const { message } = (await posted.json()) as OutputOf<typeof postMessage>;
    await advance(first + day);
    expect(deliveries).toHaveLength(3);
    delivered(deliveries[2], null);
    expect(deliveries[2]?.body).toMatchObject({ client_payload: { thread: message.thread } });
  } finally {
    await app.close();
  }
});

test("retrying a scheduled webhook keeps the delivery ID and slot", async () => {
  const { app, deliveries, advance } = fixture(true);
  try {
    await createScheduleSource(app);
    await advance(first);
    expect(deliveries).toHaveLength(1);
    delivered(deliveries[0], { id: "s1", n: 0 });
    await advance(first + 9_999);
    expect(deliveries).toHaveLength(1);
    await advance(first + 10_000);
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]).toEqual(deliveries[0]);
    await advance(first + 10_000);
    expect(deliveries).toHaveLength(2);
  } finally {
    await app.close();
  }
});
