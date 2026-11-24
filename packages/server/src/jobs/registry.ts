import type { BoardWriter, JobPayload, Jobs } from "@openboard/ports";
import type { Deps } from "../deps.ts";
import type { Tenants } from "../http/scope.ts";

/** A job effect runs under the board lock, in the same transaction that consumes its lease. */
export type JobHandler = (writer: BoardWriter, payload: JobPayload) => Promise<void>;

export function startJobs(
  jobs: Jobs,
  tenants: Tenants,
  deps: Deps,
  instance: string | (() => string),
  handlers: Readonly<Record<string, JobHandler>>,
): () => Promise<void> {
  const registry = new Map(Object.entries(handlers));
  if (registry.size === 0) return async () => {};
  const instanceId = typeof instance === "string" ? instance : instance();
  const kinds = [...registry.keys()];
  let stopped = false;
  let pending = false;
  let active: Promise<void> | undefined;

  async function run() {
    while (!stopped) {
      const lease = { instanceId, claimedAt: deps.now() };
      const job = await jobs.claim(kinds, lease);
      if (!job || stopped) return;
      const handler = registry.get(job.kind);
      if (!handler) continue;
      try {
        const ran = await tenants.jobBoard(job).write(async (writer) => {
          const payload = await writer.takeJob(job.id, lease, deps.now());
          if (payload === null) return false;
          await handler(writer, payload);
          return true;
        });
        if (ran) deps.log.info("job completed", { kind: job.kind, instanceId });
      } catch {
        // Leave the lease to expire. An unsuccessful transaction rolls back both consumption and the effect.
        deps.log.error("job failed", { kind: job.kind, instanceId });
      }
    }
  }

  async function drain() {
    try {
      do {
        pending = false;
        try {
          await run();
        } catch {
          deps.log.error("job claim failed", { instanceId });
        }
        // A notification during the last claim may describe work that missed that claim's snapshot.
      } while (!stopped && pending);
    } finally {
      active = undefined;
    }
  }

  const stop = jobs.watch(kinds, deps.schedule, async () => {
    if (stopped) return;
    pending = true;
    active ??= drain();
    await active;
  });
  return async () => {
    stopped = true;
    stop();
    await active;
  };
}
