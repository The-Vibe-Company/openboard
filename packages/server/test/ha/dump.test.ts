import { expect, test } from "bun:test";
import type { Bucket } from "@openboard/ports";
import { startDumpJob } from "../../src/jobs/dump.ts";
import { openStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";

const day = 86_400_000;
const start = 1_795_478_400_000; // 2026-11-24T00:00:00Z

function clock() {
  let now = start;
  const pending = new Map<() => void | Promise<void>, number>();
  return {
    now: () => now,
    schedule(delay: number, run: () => void | Promise<void>) {
      pending.set(run, now + delay);
      return () => {
        pending.delete(run);
      };
    },
    async advance(to: number) {
      now = to;
      await Promise.all(
        [...pending].map(async ([run, at]) => {
          if (at > now) return;
          pending.delete(run);
          await run();
        }),
      );
    },
  };
}

if (postgresTestUrl()) {
  test("two hosted runners publish one dump per UTC day and resume on the current day", async () => {
    const time = clock();
    const store = openStore(time.now);
    const peer = store.sibling?.();
    if (!peer) throw new Error("missing Postgres sibling");
    const writes: { instance: string; key: string }[] = [];
    const polls: string[] = [];
    const logs: string[] = [];
    const deps = {
      ...time,
      requestId: () => "unused",
      randomBytes: (length: number) => new Uint8Array(length),
      log: {
        info() {},
        error(message: string) {
          logs.push(message);
        },
      },
    };

    function runner(instance: string, source: typeof store) {
      const bucket: Bucket = {
        async put() {},
        async *list(prefix) {
          for (const { key } of writes) if (key.startsWith(prefix)) yield key;
        },
        async exists() {
          return false;
        },
        async read() {
          return null;
        },
        async delete() {},
        async deletePrefix() {},
        async putStream(key, stream) {
          const archive = await new Response(stream).bytes();
          expect(new TextDecoder().decode(archive.subarray(0, 5))).toBe("PGDMP");
          writes.push({ instance, key });
        },
      };
      return startDumpJob(
        async (...args) => {
          polls.push(instance);
          return (await source.dumpIfMissing?.(...args)) ?? false;
        },
        bucket,
        deps,
      );
    }

    const stop = [runner("one", store), runner("two", peer)];
    try {
      await time.advance(start + 1_000);
      expect(new Set(polls)).toEqual(new Set(["one", "two"]));
      expect(writes.map(({ key }) => key)).toEqual(["dumps/2026-11-24.dump"]);
      await time.advance(start + 61_000);
      expect(writes).toHaveLength(1);
      await time.advance(start + day);
      expect(writes.map(({ key }) => key)).toEqual(["dumps/2026-11-24.dump", "dumps/2026-11-25.dump"]);
      await Promise.all(stop.map((close) => close()));
      await time.advance(start + 4 * day);
      expect(writes).toHaveLength(2);
      stop.push(runner("one", store), runner("two", peer));
      await time.advance(start + 4 * day + 1_000);
      await time.advance(start + 4 * day + 61_000);
      expect(writes.map(({ key }) => key)).toEqual([
        "dumps/2026-11-24.dump",
        "dumps/2026-11-25.dump",
        "dumps/2026-11-28.dump",
      ]);
      expect(logs).toEqual([]);
    } finally {
      await Promise.all(stop.map((close) => close()));
    }
  });
}
