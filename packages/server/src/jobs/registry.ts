import type { BoardWriter, Job, JobLease, JobPayload, Jobs, OrgView } from "@openboard/ports";
import type { Deps } from "../deps.ts";
import type { Tenants } from "../http/scope.ts";

export interface OrgJobHandler {
  run(org: OrgView, job: Job, lease: JobLease, now: number): Promise<boolean>;
}

export type JobHandlers = Readonly<Record<string, JobHandler | OrgJobHandler>>;

/** A job effect runs under the board lock, in the same transaction that consumes its lease. */
export type JobHandler = (writer: BoardWriter, payload: JobPayload) => Promise<void>;

export function startJobs(
  jobs: Jobs,
  tenants: Tenants,
  deps: Deps,
  instance: string | undefined,
  handlers: JobHandlers,
): (release?: boolean) => Promise<void> {
  const registry = new Map(Object.entries(handlers));
  if (registry.size === 0) return async () => {};
  // A configured instance label may be reused by a replacement while the old runner is draining.
  const leaseOwner = deps.requestId();
  const instanceId = instance ?? leaseOwner;
  const kinds = [...registry.keys()];
  let stopped = false;
  let pending = false;
  let active: Promise<void> | undefined;
  let currentJob: string | undefined;

  async function run() {
    while (!stopped) {
      const lease = { instanceId: leaseOwner, claimedAt: deps.now() };
      const job = await jobs.claim(kinds, lease);
      if (!job || stopped) return;
      const handler = registry.get(job.kind);
      if (!handler) continue;
      currentJob = job.id;
      try {
        const ran =
          typeof handler === "function"
            ? await tenants.jobBoard(job).write(async (writer) => {
                const payload = await writer.takeJob(job.id, lease, deps.now());
                if (payload === null) return false;
                await handler(writer, payload);
                return true;
              })
            : await handler.run(tenants.jobOrg(job), job, lease, deps.now());
        if (ran) deps.log.info("job completed", { kind: job.kind, instanceId });
      } catch {
        // Leave the lease to expire. An unsuccessful transaction rolls back both consumption and the effect.
        deps.log.error("job failed", { kind: job.kind, instanceId });
      } finally {
        currentJob = undefined;
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
  return async (release = false) => {
    stopped = true;
    stop();
    const running = active;
    // An unfinished job must keep its lease. Return any others even if the current job hits the shutdown cap.
    if (release) await releaseLeases(jobs, deps, leaseOwner, instanceId, currentJob);
    await running;
    // A claim might have finished during shutdown, or the current effect might have rolled back.
    if (release && running) await releaseLeases(jobs, deps, leaseOwner, instanceId);
  };
}

async function releaseLeases(jobs: Jobs, deps: Deps, leaseOwner: string, instanceId: string, exceptId?: string) {
  try {
    await jobs.release(leaseOwner, deps.now(), exceptId);
  } catch {
    deps.log.error("job lease release failed", { instanceId });
  }
}
