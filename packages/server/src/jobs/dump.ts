import type { Bucket, DatabaseDump } from "@openboard/ports";
import type { Deps } from "../deps.ts";
import { errorMessage } from "../log.ts";

const DAY = 86_400_000;
const RETRY = 60_000;
const MAX_RUN = 6 * 60 * 60 * 1_000;

/** Poll the current UTC day only. A restart consults the bucket under the database lock. */
export function startDumpJob(dump: DatabaseDump | undefined, bucket: Bucket | undefined, deps: Deps) {
  if (!bucket || !dump) return async () => {};
  const shutdown = new AbortController();
  let active: Promise<void> | undefined;

  async function run(upload: DatabaseDump, destination: Bucket) {
    const now = deps.now();
    // oxlint-disable-next-line no-restricted-globals -- UTC formatting of the injected clock, never a wall-clock read.
    const day = new Date(now).toISOString().slice(0, 10);
    let delay = RETRY;
    const deadline = new AbortController();
    const cancelDeadline = deps.schedule(MAX_RUN, () => deadline.abort());
    const signal = AbortSignal.any([shutdown.signal, deadline.signal]);
    try {
      if (await upload(destination, `dumps/${day}.dump`, signal)) {
        delay = Math.max(1, (Math.floor(now / DAY) + 1) * DAY - deps.now());
      }
    } catch (error) {
      if (!shutdown.signal.aborted) deps.log.error("database dump failed", { error: errorMessage(error) });
    } finally {
      cancelDeadline();
      if (!shutdown.signal.aborted) cancel = deps.schedule(delay, tick);
    }
  }

  const tick = () => {
    if (shutdown.signal.aborted) return;
    active = run(dump, bucket);
    return active;
  };

  let cancel = deps.schedule(1_000, tick);
  return async () => {
    shutdown.abort();
    cancel();
    await active;
  };
}
