import { expect, test } from "bun:test";
import type { AuditEvent, createSchedule, InputOf, Message, ScheduleView } from "@openboard/contract";
import { isoTime } from "@openboard/core";
import { createApp } from "../../src/index.ts";
import { call, LOCAL_OWNER, NOW, OWNER, PUBLIC_URL } from "../support/app.ts";
import { cluster, type Cluster } from "../support/cluster.ts";
import { restartableStore, type TestStore } from "../support/drivers.ts";

const minute = 60_000;
const hour = 60 * minute;
const due = NOW + hour;
const restart = due + 48 * hour;

function fakeClock() {
  let now = NOW;
  const timers = new Map<() => void | Promise<void>, number>();
  let changed = Promise.withResolvers<void>();
  return {
    now: () => now,
    schedule(delay: number, run: () => void | Promise<void>) {
      timers.set(run, now + delay);
      changed.resolve();
      changed = Promise.withResolvers<void>();
      return () => {
        timers.delete(run);
      };
    },
    async waitArmed(at: number, count: number) {
      while ([...timers.values()].filter((time) => time === at).length < count) await changed.promise;
    },
    async advance(at: number) {
      now = at;
      const ready = [...timers].filter(([, time]) => time <= at);
      await Promise.all(
        ready.map(async ([run]) => {
          if (timers.delete(run)) await run();
        }),
      );
    },
  };
}

async function createReplySchedule(app: Cluster, input: InputOf<typeof createSchedule>) {
  const response = await call(app, "POST", "/schedules", input);
  expect(response.status).toBe(201);
  return ((await response.json()) as { schedule: ScheduleView }).schedule.id;
}

async function replies(app: Cluster, id: string) {
  const response = await call(app, "GET", `/messages/${id}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { replies: Message[] }).replies;
}

async function schedules(app: Cluster, query = "") {
  const response = await call(app, "GET", `/schedules${query}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { schedules: ScheduleView[] }).schedules;
}

test("restart sends each overdue schedule once, resumes its cadence, and skips expired repeats", async () => {
  const clock = fakeClock();
  const stores = restartableStore(clock.now);
  const firstStore = stores.open();
  const errors: string[] = [];
  let request = 0;
  let random = 0;
  const start = (store: TestStore) =>
    cluster(store, (peer) =>
      createApp(
        { mode: "local", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, localOwnerTokenHash: OWNER.hash },
        { store: peer, blobs: peer.blobs, jobs: peer.jobs },
        {
          now: clock.now,
          schedule: clock.schedule,
          requestId: () => `restart-${++request}`,
          randomBytes: (size) => new Uint8Array(size).fill(++random),
          log: {
            info() {},
            error(message) {
              errors.push(message);
            },
          },
        },
      ),
    );
  let app = start(firstStore);
  try {
    const root = await call(app, "POST", "/messages", { channel: "dev", text: "root" });
    expect(root.status).toBe(201);
    const {
      message: { id: re },
    } = (await root.json()) as { message: Message };
    const repeat = await createReplySchedule(app, { re, text: "hourly", every: "1h", times: 3 });
    const once = await createReplySchedule(app, { re, text: "once", in: "1h" });
    const expired = await createReplySchedule(app, { re, text: "expired", every: "1h", until: isoTime(due + hour) });
    const instanceCount = firstStore.sibling ? 2 : 1;
    expect(app.instances).toHaveLength(instanceCount);
    await clock.waitArmed(due, instanceCount);
    await clock.advance(due - minute);
    expect(await replies(app, re)).toEqual([]);
    await app.close();

    await clock.advance(restart);
    app = start(stores.open());
    expect(app.instances).toHaveLength(instanceCount);
    await clock.waitArmed(restart, instanceCount);
    await clock.advance(restart);

    const posted = (await replies(app, re)).sort((a, b) => a.text.localeCompare(b.text));
    expect(posted.map(({ schedule, createdAt }) => ({ schedule, createdAt }))).toEqual([
      { schedule: { id: repeat, n: 0 }, createdAt: isoTime(restart) },
      { schedule: { id: once, n: 0 }, createdAt: isoTime(restart) },
    ]);
    expect(await schedules(app, "?all=1")).toMatchObject([
      { id: repeat, state: "pending", sent: 1, next: isoTime(restart + hour) },
      { id: once, state: "done", sent: 1, next: null, last: posted[1]?.id },
      { id: expired, state: "done", sent: 0, next: null, last: null, canceled: null },
    ]);
    const audit = await call(app, "GET", "/x/audit");
    expect(audit.status).toBe(200);
    const { events } = (await audit.json()) as { events: AuditEvent[] };
    expect(events.map(({ type }) => type)).toEqual(Array(3).fill("ob.schedule.created"));
    await checkRemainingSends(app, clock, re, repeat);
    expect(errors).toEqual([]);
  } finally {
    try {
      await app.close();
    } finally {
      stores.cleanup();
    }
  }
});

async function checkRemainingSends(app: Cluster, clock: ReturnType<typeof fakeClock>, re: string, repeat: string) {
  for (const n of [1, 2]) {
    const slot = restart + n * hour;
    await clock.waitArmed(slot, 1);
    await clock.advance(slot);
    const posted = await replies(app, re);
    expect(posted).toHaveLength(n + 2);
    expect(posted.at(-1)).toMatchObject({ schedule: { id: repeat, n }, createdAt: isoTime(slot) });
  }
  expect(await schedules(app)).toEqual([]);
  expect((await schedules(app, "?all=1"))[0]).toMatchObject({ id: repeat, state: "done", sent: 3, next: null });
}
