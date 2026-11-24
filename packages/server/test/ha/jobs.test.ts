import { expect, test } from "bun:test";
import { messages } from "@openboard/core";
import type { JobClaim, Store } from "@openboard/ports";
import { testScope } from "@openboard/ports/testkit";
import { createApp, type JobHandler } from "../../src/index.ts";
import { LOCAL_OWNER, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";

function fakeClock(instances = 1) {
  let now = 0;
  const timers = new Map<() => void | Promise<void>, number>();
  const armed = Promise.withResolvers<void>();
  return {
    now: () => now,
    armed: armed.promise,
    pending: () => [...timers.values()].sort((a, b) => a - b),
    schedule(delay: number, run: () => void | Promise<void>) {
      timers.set(run, now + delay);
      if (timers.size === instances) armed.resolve();
      return () => {
        timers.delete(run);
      };
    },
    async advance(at: number) {
      now = at;
      const due = [...timers].filter(([, time]) => time <= at);
      await Promise.all(
        due.map(async ([run]) => {
          timers.delete(run);
          await run();
        }),
      );
    },
  };
}

function app(store: Store, instanceId: string, clock: ReturnType<typeof fakeClock>, run: JobHandler) {
  return createApp(
    { mode: "local", instanceId, publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER },
    { store, blobs: store.blobs, jobs: store.jobs },
    {
      now: clock.now,
      schedule: clock.schedule,
      log: {
        info() {},
        error(message) {
          throw new Error(message);
        },
      },
      requestId: () => "test-request",
      randomBytes: (size) => new Uint8Array(size),
    },
    { test: run },
  );
}

const hosted = postgresTestUrl() !== undefined;
test(`${hosted ? "postgres: two runners" : "sqlite: due timer"} execute every due board job once`, async () => {
  const clock = fakeClock(hosted ? 2 : 1);
  const one = openStore(clock.now);
  const two = one.sibling?.();
  const keys = await one.platform().findBoard("local", "main");
  if (!keys) throw new Error("local board is missing");
  const scope = testScope(keys);
  const board = one.board(scope);
  const runs: string[] = [];
  const run: JobHandler = async (writer, payload) => {
    const text = String(payload.text);
    const by = { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null };
    const posted = messages.decidePost({ head: writer.head }, { channel: "jobs/test", text }, { by, now: clock.now() });
    await writer.append(posted.events);
    runs.push(text);
  };
  const first = app(one, "one", clock, run);
  const second = two && app(two, "two", clock, run);
  try {
    const expected = Array.from({ length: 20 }, (_, i) => `job-${i}`).sort();
    await board.write(async (writer) => {
      for (const text of expected) await writer.enqueue("test", 2000, { text });
    });
    await clock.armed;
    expect(clock.pending()).toEqual(two ? [2000, 2000] : [2000]);
    await clock.advance(1000);
    expect(runs).toEqual([]);
    expect(clock.pending()).toEqual(two ? [2000, 2000] : [2000]);
    await clock.advance(2000);
    expect(runs.sort()).toEqual(expected);
    await clock.advance(32_000);
    expect(clock.pending()).toEqual([]);
    expect(runs.sort()).toEqual(expected);
    expect((await board.channelMessages({ channel: "jobs/test", limit: 50 }))?.map(({ text }) => text).sort()).toEqual(
      expected,
    );
  } finally {
    await Promise.all([first.close(), second?.close()]);
  }
});

if (hosted)
  test("postgres: a stopped instance's expired lease is picked up by its sibling", async () => {
    const clock = fakeClock();
    const one = openStore(clock.now);
    const two = one.sibling?.();
    const keys = await one.platform().findBoard("local", "main");
    if (!two || !keys) throw new Error("Postgres cluster fixture is missing");
    const ran: unknown[] = [];
    const second = app(two, "two", clock, async (_writer, payload) => {
      ran.push(payload);
    });
    try {
      await one.board(testScope(keys)).write((writer) => writer.enqueue("test", 2000, { text: "recovered" }));
      await clock.armed;
      // Pick without entering a board write, then stop the instance before its effect.
      expect((await one.jobs.claim(["test"], { instanceId: "one", claimedAt: 2000 })).job).toMatchObject(keys);
      await one.close();
      await clock.advance(2_000);
      expect(clock.pending()).toEqual([32_000]);
      await clock.advance(31_999);
      expect(ran).toEqual([]);
      await clock.advance(32_000);
      expect(ran).toEqual([{ text: "recovered" }]);
    } finally {
      await Promise.all([one.close(), second.close()]);
    }
  });

test("a wake during an empty claim triggers another claim before returning its next due time", async () => {
  const clock = fakeClock();
  const store = openStore(clock.now);
  const observed = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<JobClaim>();
  let wake: (() => Promise<number | null>) | undefined;
  let claims = 0;
  const runner = app(
    {
      ...store,
      jobs: {
        ...store.jobs,
        claim: async () => {
          if (++claims !== 1) return { job: null, nextDue: null };
          observed.resolve();
          return reply.promise;
        },
        watch: (_kinds, _schedule, run) => {
          wake = run;
          return () => {};
        },
      },
    },
    "one",
    clock,
    async () => {},
  );
  try {
    if (!wake) throw new Error("runner did not subscribe");
    const first = wake();
    await observed.promise;
    const second = wake();
    reply.resolve({ job: null, nextDue: null });
    await Promise.all([first, second]);
    expect(claims).toBe(2);
  } finally {
    reply.resolve({ job: null, nextDue: null });
    await runner.close();
  }
});
