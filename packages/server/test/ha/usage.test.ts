import { expect, test } from "bun:test";
import { boards, dailyEventWindow, messages, orgs } from "@openboard/core";
import { type BoardKeys, type BoardView, type JobSchedule, type Store, USAGE_ROLLUP_JOB } from "@openboard/ports";
import { seedWebhook, testOrgScope, testScope } from "@openboard/ports/testkit";
import { createApp, maintenanceJobs, usageJobs } from "../../src/index.ts";
import { signIn } from "../isolation/seed.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";

const dayMs = 86_400_000;
const { day, nextDay } = dailyEventWindow(NOW);
const hosted = postgresTestUrl() !== undefined;
const instances = hosted ? ["one", "two"] : ["one"];

function fakeClock() {
  let now = NOW;
  let armed = Promise.withResolvers<void>();
  const timers = new Map<() => void | Promise<void>, number>();
  const schedule: JobSchedule = (delay, run) => {
    timers.set(run, now + delay);
    if (timers.size === instances.length) armed.resolve();
    return () => timers.delete(run);
  };
  return {
    now: () => now,
    schedule,
    setTime(at: number) {
      now = at;
    },
    waitForRunners: () => armed.promise,
    reset() {
      armed = Promise.withResolvers<void>();
    },
    async advance(at: number) {
      now = at;
      await Promise.all(
        [...timers].map(async ([run, due]) => {
          if (due <= at) {
            timers.delete(run);
            await run();
          }
        }),
      );
    },
  };
}

function runners(store: ReturnType<typeof openSnapshotStore>, clock: ReturnType<typeof fakeClock>) {
  const polls: string[] = [];
  const completed: string[] = [];
  const apps = instances.map((instanceId, index) => {
    const instance = index === 0 ? store : store.sibling?.();
    if (!instance) throw new Error("missing second runner");
    let id = 0;
    return createApp(
      { mode: "local", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, instanceId },
      {
        store: { ...instance, close: async () => {} },
        jobs: {
          ...instance.jobs,
          claim(kinds, lease) {
            polls.push(instanceId);
            return instance.jobs.claim(kinds, lease);
          },
        },
      },
      {
        now: clock.now,
        schedule: clock.schedule,
        requestId: () => `${instanceId}-${++id}`,
        randomBytes: (size) => new Uint8Array(size),
        log: {
          info(message, { kind }) {
            if (message === "job completed" && kind === USAGE_ROLLUP_JOB) completed.push(instanceId);
          },
          error(message) {
            throw new Error(message);
          },
        },
      },
      { ...maintenanceJobs, ...usageJobs },
    );
  });
  return { polls, completed, stop: () => Promise.all(apps.map((app) => app.close())) };
}

async function createOrg(store: Store, slug: string, digit: string, twoBoards = false) {
  const { personId } = await signIn(store, `${slug}-owner`, digit);
  const by = `ob:user:${personId}`;
  const platform = store.platform();
  await platform.createOrg({ ...orgs.decideCreate({ slug, name: slug }, { by, now: NOW }), personId, now: NOW });
  const keys = await platform.findBoard(slug, "main");
  if (!keys) throw new Error("missing main board");
  const org = store.org(testOrgScope(keys.orgId));
  const main = store.board(testScope(keys));
  if (!twoBoards) return { keys, org, main, personId, sibling: main };
  expect(
    await org.createBoard(boards.decideCreateBoard({ slug: "ops", name: "Ops" }, { by, now: NOW }), personId),
  ).toBe("created");
  const sibling = await platform.findBoard(slug, "ops");
  if (!sibling) throw new Error("missing sibling board");
  return { keys, org, main, personId, sibling: store.board(testScope(sibling)) };
}

const principal = "ob:conn:cn_aaaaaaaaaaaaaaaa";
function post(board: BoardView, at: number, count: number, profiles: (string | null)[]) {
  return board.write(async (writer) => {
    let bytes = 0;
    for (let index = 0; index < count; index++) {
      const profile = profiles[index % profiles.length] ?? null;
      const actor = profile ? `${principal}+${profile}` : LOCAL_OWNER;
      const by = { actor, principal: profile ? principal : actor, profile };
      const { events, message } = messages.decidePost(
        { head: writer.head },
        { channel: "dev", text: "héllo" },
        {
          by,
          now: at,
        },
      );
      await writer.append(events);
      bytes += Buffer.byteLength(message.text) + Buffer.byteLength(JSON.stringify(message.blocks));
    }
    return bytes;
  });
}

async function ping(board: BoardView, record: Awaited<ReturnType<typeof seedWebhook>>, id: string, at: number) {
  await board.write(async (writer) => {
    expect(await writer.beginWebhookPing(record, id, at)).not.toBeNull();
    expect(await writer.finishWebhookAttempt(id, 1, { state: "done", now: at, status: 200, error: null })).toBe(true);
  });
}

test(`${hosted ? "Postgres: both runners poll" : "SQLite"} rolls up completed UTC activity once per organization and purges it`, async () => {
  const clock = fakeClock();
  const store = openSnapshotStore(clock.now);
  const a = await createOrg(store, "alpha", "a", true);
  const b = await createOrg(store, "bravo", "b");
  const hook = await seedWebhook(a.main, "aaaaaaaaaaaaaaaa", LOCAL_OWNER);
  for (const digit of ["b", "c", "d"]) await ping(a.main, hook, `dl_${digit.repeat(16)}`, NOW);
  const bytesA =
    (await post(a.main, NOW, 19, ["writer", null])) + (await post(a.sibling, NOW, 20, ["writer", "reviewer"]));
  const bytesB = await post(b.main, NOW, 2, [null]);

  const rollups = async (keys: BoardKeys) => {
    const { rows } = await store.tenantRows(keys);
    return (rows.usage_daily ?? [])
      .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])))
      .sort((left, right) => Number(left.day) - Number(right.day));
  };
  const alphaDay = { org_id: a.keys.orgId, day, events: 40, bytes_stored: bytesA, deliveries: 3, active_agents: 2 };
  const bravoDay = { org_id: b.keys.orgId, day, events: 2, bytes_stored: bytesB, deliveries: 0, active_agents: 0 };
  const lateDay = { ...alphaDay, events: 42, deliveries: 4, active_agents: 3 };
  let bytesAfterLate = bytesA;
  const running = runners(store, clock);
  try {
    await clock.waitForRunners();
    await clock.advance(nextDay - 1);
    expect(await rollups(a.keys)).toEqual([]);
    await clock.advance(nextDay);
    expect(new Set(running.polls)).toEqual(new Set(instances));
    expect(running.completed).toHaveLength(2);
    expect(await rollups(a.keys)).toEqual([alphaDay]);
    expect(await rollups(b.keys)).toEqual([bravoDay]);

    // These writes reach the database after the rollup with timestamps in the already-recorded day.
    bytesAfterLate += await post(a.main, NOW + 1, 1, ["reviewer"]);
    bytesAfterLate += await post(a.sibling, NOW + 2, 1, ["late"]);
    await ping(a.main, hook, "dl_ffffffffffffffff", NOW + 3);
    expect(await rollups(a.keys)).toEqual([lateDay]);
    expect(running.completed).toHaveLength(2);
  } finally {
    await running.stop();
  }

  const addedBytes = await post(a.sibling, nextDay, 1, ["reviewer"]);
  const duringOutage = "dl_eeeeeeeeeeeeeeee";
  await ping(a.main, hook, duringOutage, nextDay);
  const resumedAt = nextDay + 8 * dayMs;
  clock.setTime(resumedAt);
  await store.platform().sweepExpired(resumedAt);
  expect((await a.main.webhookDeliveries(hook.webhook.id, { limit: 10 })).map(({ id }) => id)).toEqual([duringOutage]);

  await a.org.deleteOrg(a.personId, resumedAt);
  clock.reset();
  const restarted = runners(store, clock);
  try {
    await clock.waitForRunners();
    await clock.advance(resumedAt);
    expect(new Set(restarted.polls)).toEqual(new Set(instances));
    expect(restarted.completed).toHaveLength(1);
    expect(await rollups(a.keys)).toEqual([
      lateDay,
      {
        ...alphaDay,
        day: nextDay,
        events: 1,
        bytes_stored: bytesAfterLate + addedBytes,
        deliveries: 1,
        active_agents: 1,
      },
    ]);
    expect(await a.main.webhookDeliveries(hook.webhook.id, { limit: 10 })).toEqual([]);

    await clock.advance(resumedAt + 30 * dayMs);
    expect(await rollups(a.keys)).toEqual([]);
    expect(await rollups(b.keys)).toEqual([bravoDay]);
  } finally {
    await restarted.stop();
  }
});
