import type { BoardWriter, Bucket, Job, JobLease, JobPayload, Jobs, OrgView } from "@openboard/ports";
import type { Deps } from "../deps.ts";
import type { Tenants } from "../http/scope.ts";

export interface OrgJobHandler {
  run(org: OrgView, job: Job, lease: JobLease, now: number, bucket?: Bucket): Promise<boolean>;
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
  bucket?: Bucket,
): (release?: boolean) => Promise<void> {
  const registry = new Map(Object.entries(handlers));
  if (registry.size === 0) return async () => {};
  // A configured instance label may be reused by a replacement while the old runner is draining.
  const leaseOwner = deps.requestId();
  const instanceId = instance ?? leaseOwner;
  const kinds = [...registry.keys()];
  let stopped = false;
  let pending = false;
  let active: Promise<number | null> | undefined;
  let currentJob: string | undefined;

  async function run() {
    while (!stopped) {
      const lease = { instanceId: leaseOwner, claimedAt: deps.now() };
      const claim = await jobs.claim(kinds, lease);
      if (stopped) return null;
      if (!claim.job) return claim.nextDue;
      const { job } = claim;
      const handler = registry.get(job.kind);
      if (!handler) continue;
      currentJob = job.id;
      try {
        const ran = await runEffect(tenants, handler, job, lease, deps.now, bucket);
        if (ran) deps.log.info("job completed", { kind: job.kind, instanceId });
      } catch {
        // Leave the lease to expire. An unsuccessful transaction rolls back both consumption and the effect.
        deps.log.error("job failed", { kind: job.kind, instanceId });
      } finally {
        currentJob = undefined;
      }
    }
    return null;
  }

  async function drain() {
    try {
      let nextDue: number | null;
      do {
        pending = false;
        try {
          nextDue = await run();
        } catch {
          deps.log.error("job claim failed", { instanceId });
          nextDue = deps.now() + 1_000;
        }
        // A notification during the last claim may describe work that missed that claim's snapshot.
      } while (!stopped && pending);
      return nextDue;
    } finally {
      active = undefined;
    }
  }

  const stop = jobs.watch(kinds, deps.schedule, async () => {
    if (stopped) return null;
    pending = true;
    active ??= drain();
    return active;
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

function runEffect(
  tenants: Tenants,
  handler: JobHandler | OrgJobHandler,
  job: Job,
  lease: JobLease,
  now: () => number,
  bucket?: Bucket,
): Promise<boolean> {
  if (typeof handler !== "function") return handler.run(tenants.jobOrg(job), job, lease, now(), bucket);
  return tenants.jobBoard(job).write(async (writer) => {
    const payload = await writer.takeJob(job.id, lease, now());
    if (payload === null) return false;
    await handler(writer, payload);
    return true;
  });
}

async function releaseLeases(jobs: Jobs, deps: Deps, leaseOwner: string, instanceId: string, exceptId?: string) {
  try {
    await jobs.release(leaseOwner, deps.now(), exceptId);
  } catch {
    deps.log.error("job lease release failed", { instanceId });
  }
}
