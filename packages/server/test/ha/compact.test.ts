import { expect, test } from "bun:test";
import { channels, messages } from "@openboard/core";
import {
  type BoardKeys,
  type BoardView,
  type Bucket,
  type JobSchedule,
  type LogSegment,
  type PlatformView,
  type Store,
  USAGE_ROLLUP_JOB,
} from "@openboard/ports";
import { fakeBucket, testOrgScope, testScope } from "@openboard/ports/testkit";
import { createApp } from "../../src/index.ts";
import { call, LOCAL_OWNER, NOW, OWNER, PUBLIC_URL } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";

const day = 86_400_000;
const due = NOW + 31 * day;
const kind = "fixture-compaction-trigger";
const by = { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null };

function fakeClock(instances: number) {
  let now = NOW;
  const armed = Promise.withResolvers<void>();
  const timers = new Map<() => void | Promise<void>, number>();
  const schedule: JobSchedule = (delay, run) => {
    timers.set(run, now + delay);
    if (timers.size === instances) armed.resolve();
    return () => timers.delete(run);
  };
  return {
    now: () => now,
    schedule,
    armed: armed.promise,
    async advance(at: number) {
      now = at;
      await Promise.all(
        [...timers]
          .filter(([, time]) => time <= at)
          .map(async ([run]) => {
            timers.delete(run);
            await run();
          }),
      );
    },
  };
}

type Compact = PlatformView["compactActorSightings"];

function raceCompaction(instances: number) {
  const barrier = Promise.withResolvers<void>();
  const complete = Promise.withResolvers<void>();
  const attempts: string[] = [];
  const deletions: string[] = [];
  let finished = 0;
  return {
    attempts,
    deletions,
    complete: complete.promise,
    async run(id: string, compact: () => ReturnType<Compact>) {
      attempts.push(id);
      if (attempts.length === instances) barrier.resolve();
      await barrier.promise;
      try {
        const result = await compact();
        if (result.deleted) deletions.push(`${id}: ${result.deleted}`);
        return result;
      } finally {
        if (++finished === instances) complete.resolve();
      }
    },
  };
}

function runner(
  store: Store,
  id: string,
  clock: ReturnType<typeof fakeClock>,
  polls: string[],
  observe: (id: string, compact: () => ReturnType<Compact>) => ReturnType<Compact>,
  bucket?: Bucket,
) {
  let sequence = 0;
  const platform = store.platform();
  return createApp(
    { mode: "local", instanceId: id, publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, localOwnerTokenHash: OWNER.hash },
    {
      store: {
        ...store,
        platform: () =>
          new Proxy(platform, {
            get(target, key, receiver) {
              if (key !== "compactActorSightings") return Reflect.get(target, key, receiver);
              const compact: Compact = (...args) => observe(id, () => target.compactActorSightings(...args));
              return compact;
            },
          }),
      },
      blobs: store.blobs,
      ...(bucket && { bucket }),
      jobs: {
        ...store.jobs,
        // Exercise the regular runners. Ship directly below to control exactly when the durable watermark advances.
        watch(kinds, schedule, wake) {
          return kinds.includes(kind) ? store.jobs.watch(kinds, schedule, wake) : () => {};
        },
        claim(kinds, lease) {
          polls.push(id);
          return store.jobs.claim(kinds, lease);
        },
      },
    },
    {
      now: clock.now,
      schedule: clock.schedule,
      requestId: () => `${id}-${++sequence}`,
      randomBytes: (length) => new Uint8Array(length),
      log: {
        info() {},
        error(message) {
          throw new Error(message);
        },
      },
    },
    { [kind]: async () => {} },
  );
}

async function seed(board: BoardView, withBucket: boolean) {
  await board.write(async (writer) => {
    await writer.append(
      Array.from(
        { length: 198 },
        (_, index) =>
          channels.decideCreate({ head: index, existing: null }, `history-${index}`, { by, now: NOW }).events,
      ).flat(),
    );
    const cutoff = NOW + day + (withBucket ? 60_000 : 0);
    for (const [index, at] of [NOW, NOW, cutoff, cutoff + 1, cutoff + 2].entries()) {
      const author = { kind: "person" as const, handle: "local-test", name: `Name ${index}`, avatar: null };
      await writer.append(
        messages.decidePost(
          { head: writer.head, actor: null },
          { channel: "ops", text: author.name },
          { by, author, now: at },
        ).events,
      );
    }
    await writer.enqueue(kind, due, {});
    if (withBucket) await writer.enqueue(kind, due + 60_000, {});
  });
}

async function recordFirstUsageDay(store: Store, keys: BoardKeys) {
  const platform = store.platform();
  expect((await platform.compactActorSightings(keys, due - 30 * day, false)).deleted).toBe(0);
  const lease = { instanceId: "fixture-usage", claimedAt: due - 1 };
  const { job } = await store.jobs.claim([USAGE_ROLLUP_JOB], lease);
  if (!job) throw new Error("missing usage rollup for the old sightings");
  expect(await store.org(testOrgScope(keys.orgId)).rollupUsage(job.boardId, job.id, lease, lease.claimedAt)).toBe(true);
}

async function expectSameFolds(
  store: ReturnType<typeof openSnapshotStore>,
  keys: BoardKeys,
  before: Record<string, readonly object[]>,
) {
  const rebuilt = (await store.tenantRows(keys)).rows;
  for (const table of [
    "actors",
    "channels",
    "connection_agents",
    "connections",
    "grant_principals",
    "grants",
    "inbound_endpoints",
    "messages",
    "schedules",
    "schemas",
    "task_batches",
    "task_needs",
    "tasks",
    "terms",
    "watcher_registrations",
    "webhooks",
  ]) {
    const serialize = (rows: readonly object[] | undefined) => rows?.map((row) => JSON.stringify(row)).sort();
    expect(serialize(rebuilt[table]), table).toEqual(serialize(before[table]));
  }
}

async function readPage(app: ReturnType<typeof runner>, after: number) {
  const response = await call(app, "GET", `/events?all=true&after=${after}`);
  expect(response.status).toBe(200);
  return (await response.json()) as { cursor: string; events: { cursor: string }[] };
}

const mode = postgresTestUrl() ? "Postgres: both runners poll" : "SQLite";
for (const withBucket of [false, true]) {
  test(`${mode} compacts only eligible sightings ${withBucket ? "after shipping" : "without a bucket"}`, async () => {
    const clock = fakeClock(postgresTestUrl() ? 2 : 1);
    const store = openSnapshotStore(clock.now);
    const sibling = store.sibling?.();
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing fixture board");
    const board = store.board(testScope(keys));
    await seed(board, withBucket);
    await recordFirstUsageDay(store, keys);
    const bucket = withBucket ? fakeBucket().bucket : undefined;
    const polls: string[] = [];
    const ids = sibling ? ["one", "two"] : ["one"];
    let race = raceCompaction(ids.length);
    const observe: typeof race.run = (id, compact) => race.run(id, compact);
    const first = runner(store, "one", clock, polls, observe, bucket);
    const second = sibling && runner(sibling, "two", clock, polls, observe, bucket);
    const wake = async (at: number) => {
      await clock.advance(at);
      // The due job can wake one runner. A successful, idempotent mutation wakes the other.
      for (const app of second ? [first, second] : [first]) {
        expect((await call(app, "POST", "/channels", { path: "history-0" })).ok).toBe(true);
      }
      await race.complete;
      expect(race.attempts.sort()).toEqual(ids);
    };
    const snapshot = async () => (await store.tenantRows(keys)).rows;
    try {
      const before = await snapshot();
      const events = before.events ?? [];
      const removed = 201;
      expect(events.find(({ id }) => Number(id) === removed)?.type).toBe("actor.seen");
      const segments: LogSegment[] = [];
      const ship = () =>
        store.org(testOrgScope(keys.orgId)).shipLogs(
          async (segment) => {
            if (segment.boardId === keys.boardId) segments.push(segment);
          },
          () => false,
          clock.now,
        );
      await clock.armed;
      await wake(due);
      expect(new Set(polls)).toEqual(new Set(ids));

      if (withBucket) {
        expect(race.deletions).toEqual([]);
        expect((await snapshot()).events).toEqual(events);
        await ship();
        race = raceCompaction(ids.length);
        await wake(due + 60_000);
      }

      expect(race.deletions).toHaveLength(1);
      expect(race.deletions[0]).toMatch(/^(one|two): 1$/);
      const expected = events.filter(({ id }) => Number(id) !== removed);
      expect((await snapshot()).events).toEqual(expected);
      if (!withBucket) await ship();
      expect(segments.map(({ first, last }) => [first, last])).toEqual([[1, 208]]);
      expect(segments.flatMap(({ events }) => events.map((event) => (event as { id: number }).id))).toEqual(
        (withBucket ? events : expected).map(({ id }) => Number(id)),
      );

      const page = await readPage(first, 0);
      expect(page.cursor).toBe("200");
      const next = await readPage(first, Number(page.cursor));
      expect(next.cursor).toBe("208");
      expect(await readPage(first, removed)).toEqual(next);
      expect([...page.events, ...next.events].map(({ cursor }) => Number(cursor))).toEqual(
        expected.map(({ id }) => Number(id)),
      );

      expect((await store.platform().reprojectBoard(keys))?.events).toBe(expected.length);
      await expectSameFolds(store, keys, before);
    } finally {
      await Promise.all([first.close(), second?.close()]);
    }
  });
}
