import { expect, test } from "bun:test";
import { messages } from "@openboard/core";
import type { Store } from "../src/index.ts";
import { type OpenStore, testScope } from "./index.ts";

export function runJobsSuite(driver: string, open: OpenStore): void {
  test(`${driver}: jobs honor due times, kinds, rollback, and lease ownership`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("local board is missing");
      const board = store.board(testScope(keys));
      const enqueue = () => board.write((writer) => writer.enqueue("test", 100, { message: "queued" }));
      await expect(
        board.write(async (writer) => {
          await writer.enqueue("test", 0, {});
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      await enqueue();

      const first = { instanceId: "first", claimedAt: 100 };
      const second = { instanceId: "second", claimedAt: 30_100 };
      expect((await store.jobs.claim(["test"], { ...first, claimedAt: 99 })).job).toBeNull();
      expect((await store.jobs.claim(["unknown"], first)).job).toBeNull();
      const job = (await store.jobs.claim(["test"], first)).job;
      if (!job) throw new Error("due job is missing");
      expect(job).toEqual({ ...keys, id: expect.any(String), kind: "test" });
      expect((await store.jobs.claim(["test"], { ...second, claimedAt: 30_099 })).job).toBeNull();
      expect((await store.jobs.claim(["test"], second)).job).toEqual(job);
      await board.write(async (writer) => {
        expect(await writer.takeJob(job.id, first, first.claimedAt)).toBeNull();
      });
      await expect(
        board.write(async (writer) => {
          expect(await writer.takeJob(job.id, second, second.claimedAt)).toEqual({ message: "queued" });
          const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };
          const post = messages.decidePost(
            { head: writer.head },
            { channel: "jobs/test", text: "must roll back" },
            { by, now: second.claimedAt },
          );
          await writer.append(post.events);
          throw new Error("effect failed");
        }),
      ).rejects.toThrow("effect failed");
      expect(await board.channelMessages({ channel: "jobs/test", limit: 10 })).toEqual([]);
      await board.write(async (writer) => {
        expect(await writer.takeJob(job.id, second, second.claimedAt)).toEqual({ message: "queued" });
        expect(await writer.takeJob(job.id, second, second.claimedAt)).toBeNull();
      });
      expect((await store.jobs.claim(["test"], { ...second, claimedAt: 100_000 })).job).toBeNull();
    } finally {
      await store.close();
    }
  });
}

/** Both stores share one database and use the same fake clock. SQLite uses a single store. */
export type WithJobStores = (now: () => number, run: (writer: Store, peer?: Store) => Promise<void>) => Promise<void>;

export function runJobWakeSuite(driver: string, withStores: WithJobStores): void {
  const runners = driver === "postgres" ? ["writer", "peer"] : ["writer"];
  for (const runner of runners) {
    test(`${driver}: ${runner} rearms for an earlier enqueue, runs due work, then stays idle`, async () => {
      const clock = jobClock();
      await withStores(clock.now, async (writer, peer) => {
        const store = runner === "peer" ? peer : writer;
        const keys = await writer.platform().findBoard("local", "main");
        if (!store || !keys) throw new Error("job fixture is missing");
        const enqueue = (dueAt: number) =>
          writer.board(testScope(keys)).write((board) => board.enqueue("test", dueAt, { dueAt }));
        await enqueue(4_000);
        const ran: unknown[] = [];
        const stop = store.jobs.watch(["test"], clock.schedule, async () => {
          const lease = { instanceId: runner, claimedAt: clock.now() };
          const claim = await store.jobs.claim(["test"], lease);
          if (!claim.job) return claim.nextDue;
          const { id } = claim.job;
          ran.push(await store.board(testScope(keys)).write((board) => board.takeJob(id, lease, clock.now())));
          const remaining = await store.jobs.claim(["test"], lease);
          if (remaining.job) throw new Error("only one job should be due");
          return remaining.nextDue;
        });
        try {
          await clock.armedAt(4_000);
          await enqueue(2_000);
          await clock.armedAt(2_000);
          expect(clock.pending()).toEqual([2_000]);
          await clock.advance(1_999);
          expect(ran).toEqual([]);
          await clock.advance(2_000);
          expect(ran).toEqual([{ dueAt: 2_000 }]);
          expect(clock.pending()).toEqual([4_000]);
          await clock.advance(4_000);
          expect(ran).toEqual([{ dueAt: 2_000 }, { dueAt: 4_000 }]);
          expect(clock.pending()).toEqual([]);
        } finally {
          stop();
        }
      });
    });
  }
}

function jobClock() {
  let now = 0;
  const timers = new Map<() => void | Promise<void>, number>();
  const armed = new Map<number, PromiseWithResolvers<void>>();
  return {
    now: () => now,
    pending: () => [...timers.values()],
    armedAt(at: number) {
      if ([...timers.values()].includes(at)) return Promise.resolve();
      const signal = Promise.withResolvers<void>();
      armed.set(at, signal);
      return signal.promise;
    },
    schedule(delay: number, run: () => void | Promise<void>) {
      const at = now + delay;
      timers.set(run, at);
      armed.get(at)?.resolve();
      armed.delete(at);
      return () => {
        timers.delete(run);
      };
    },
    async advance(at: number) {
      now = at;
      const due = Array.from(timers).filter(([, time]) => time <= at);
      for (const [run] of due) {
        timers.delete(run);
        await run();
      }
    },
  };
}
