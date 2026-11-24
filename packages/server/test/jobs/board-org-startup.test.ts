import { expect, test } from "bun:test";
import { startBoardOrgBackfill } from "../../src/jobs/board-org-startup.ts";

test("retries a failed startup sweep and aborts in-flight discovery on close", async () => {
  const retry = Promise.withResolvers<() => void>();
  const retryStarted = Promise.withResolvers<AbortSignal>();
  const finish = Promise.withResolvers<void>();
  const times: number[] = [];
  const errors: string[] = [];
  let now = 10;
  const stop = startBoardOrgBackfill(
    {
      async queueBoardOrgBackfill(at, signal) {
        times.push(at);
        if (times.length === 1) throw new Error("database unavailable");
        if (!signal) throw new Error("missing shutdown signal");
        retryStarted.resolve(signal);
        await finish.promise;
      },
    },
    {
      now: () => now,
      schedule(delay, run) {
        expect(delay).toBe(1000);
        retry.resolve(run);
        return () => {};
      },
      log: { info() {}, error: (message) => errors.push(message) },
      requestId: () => "test",
      randomBytes: (length) => new Uint8Array(length),
    },
  );

  const runRetry = await retry.promise;
  expect(errors).toEqual(["could not queue board organization backfill"]);
  now = 1010;
  runRetry();
  const signal = await retryStarted.promise;
  expect(times).toEqual([10, 1010]);
  const closing = stop();
  expect(signal.aborted).toBe(true);
  finish.resolve();
  await closing;
});
