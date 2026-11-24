import { afterAll, beforeAll, expect, test } from "bun:test";
import type { createWebhook, OutputOf } from "@openboard/contract";
import { messages } from "@openboard/core";
import { type Jobs, WEBHOOK_DELIVERY_JOB } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { signIn } from "../isolation/seed.ts";
import { makeApp, NOW, PUBLIC_URL } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";

const minute = 60_000;
const nextWindow = NOW - (NOW % minute) + minute;

function fixture() {
  let time = NOW;
  const now = () => time;
  const store = openSnapshotStore(now);
  const wakes: Array<Parameters<Jobs["watch"]>[2]> = [];
  const sent: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const app = makeApp({
    store,
    now,
    signup: "open",
    secretKey: new Uint8Array(32).fill(12),
    schedule: () => () => {},
    watchJobs: (_kinds, _schedule, wake) => {
      wakes.push(wake);
      return () => {};
    },
    webhookFetch: async (request) => {
      peak = Math.max(peak, ++inFlight);
      const { board } = (await request.json()) as { board: { org: string } };
      sent.push(board.org);
      inFlight--;
      return new Response(null, { status: 204 });
    },
  });

  return {
    app,
    store,
    now,
    sent,
    peak: () => peak,
    advance: (at: number) => {
      time = at;
    },
    run: () => Promise.all(wakes.map((wake) => wake())),
    claim: () => store.jobs.claim([WEBHOOK_DELIVERY_JOB], { instanceId: "next-window", claimedAt: time }),
  };
}

async function seed({ app, store, now }: ReturnType<typeof fixture>, slug: string, digit: string) {
  const { headers, personId } = await signIn(store, slug, digit);
  const send = (path: string, body: unknown) =>
    app.fetch(
      new Request(PUBLIC_URL + path, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  expect((await send("/api/x/orgs", { slug, name: slug })).status).toBe(201);
  const response = await send(`/api/${slug}/main/x/webhooks`, {
    name: "delivery",
    url: "http://127.0.0.1:9000/hook",
    filter: { tail: "dev", types: ["message.posted"] },
  });
  expect(response.status).toBe(201);
  const { webhook } = (await response.json()) as OutputOf<typeof createWebhook>;
  const keys = await store.platform().findBoard(slug, "main");
  if (!keys) throw new Error("missing test board");
  const board = store.board(testScope(keys));
  const actor = `ob:user:${personId}`;
  return {
    keys,
    async queue(count: number) {
      await board.write(async (writer) => {
        const context = { by: { actor, principal: actor, profile: null }, now: now() };
        const events = Array.from({ length: count }, (_, index) =>
          messages.decidePost({ head: writer.head + index }, { channel: "dev", text: "delivery" }, context),
        );
        await writer.append(events.flatMap(({ events }) => events));
      });
    },
    async snapshot() {
      const { rows } = await store.tenantRows(keys);
      return {
        deliveries: (rows.webhook_deliveries ?? []).filter((row) => row.webhook === webhook.id),
        rates: (rows.tenant_rate_counters ?? []).map((row) => Number(row.n)),
      };
    },
  };
}

const f = fixture();
let alpha: Awaited<ReturnType<typeof seed>>;
let bravo: typeof alpha;

beforeAll(async () => {
  alpha = await seed(f, "alpha", "a");
  bravo = await seed(f, "bravo", "b");
  // Warm the shared window with real deliveries before constructing the flood.
  await alpha.queue(590);
  await f.run();
  expect(f.sent).toHaveLength(590);
});
// Keep fixture transactions short on Postgres. All 5,000 rows share the same fake due time.
for (let batch = 0; batch < 5; batch++) {
  beforeAll(() => alpha.queue(1_000));
}
beforeAll(() => bravo.queue(10));
afterAll(() => f.app.close());

test("two tenants share dispatch capacity while a capped tenant waits for the next minute", async () => {
  // Wake both hosted instances together, so their separate database connections compete for the last slots.
  await f.run();
  expect(f.sent.filter((org) => org === "alpha")).toHaveLength(600);
  expect(f.sent.filter((org) => org === "bravo")).toHaveLength(10);
  expect(await f.run()).toEqual(f.app.instances.map(() => nextWindow));
  const [a, b] = await Promise.all([alpha.snapshot(), bravo.snapshot()]);
  expect(a.rates).toEqual([600]);
  expect(b.rates).toEqual([10]);
  expect(a.deliveries).toHaveLength(5_590);
  expect(a.deliveries.filter((row) => row.state === "done")).toHaveLength(600);
  expect(a.deliveries.filter((row) => row.state === "pending" && Number(row.attempt) === 0)).toHaveLength(4_990);
  expect(b.deliveries).toHaveLength(10);
  expect(b.deliveries.every((row) => row.state === "done")).toBe(true);
  expect(f.peak()).toBeGreaterThan(0);
  expect(f.peak()).toBeLessThanOrEqual(32);
  expect(f.app.logged).toEqual([]);

  f.advance(nextWindow - 1);
  expect(await f.claim()).toEqual({ job: null, nextDue: nextWindow });
  f.advance(nextWindow);
  expect((await f.claim()).job).toMatchObject(alpha.keys);
});
