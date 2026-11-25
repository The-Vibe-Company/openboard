import {
  BLOB_GC_JOB,
  type BoardView,
  type BoardWriter,
  type Bucket,
  type Job,
  type JobLease,
  type JobPayload,
  type Jobs,
  type OrgView,
  SCHEDULE_SEND_JOB,
  TASK_EXPIRY_JOB,
} from "@openboard/ports";
import type { Deps } from "../deps.ts";
import type { Tenants } from "../http/scope.ts";
import { errorMessage } from "../log.ts";
import { blobGcJob } from "./blob-gc.ts";
import { scheduleSendJob } from "./schedules.ts";
import { taskExpiryJob } from "./task-expiry.ts";

export interface OrgJobHandler {
  run(org: OrgView, job: Job, lease: JobLease, now: number, bucket?: Bucket): Promise<boolean>;
}

export interface ExternalBoardJobHandler {
  runBoard(board: BoardView, job: Job, lease: JobLease): Promise<boolean>;
}

export type JobHandlers = Readonly<Record<string, JobHandler | OrgJobHandler | ExternalBoardJobHandler>>;

/** A job effect runs under the board lock, in the same transaction that consumes its lease. */
export type JobHandler = (writer: BoardWriter, payload: JobPayload, now: number) => Promise<void>;

export function startBoardJobs(
  jobs: Jobs,
  tenants: Tenants,
  deps: Deps,
  instance: string | undefined,
  handlers: JobHandlers,
  bucket: Bucket | undefined,
  onActivity: () => Promise<void>,
) {
  return startJobs(
    jobs,
    tenants,
    deps,
    instance,
    { ...handlers, [TASK_EXPIRY_JOB]: taskExpiryJob, [SCHEDULE_SEND_JOB]: scheduleSendJob, [BLOB_GC_JOB]: blobGcJob },
    bucket,
    onActivity,
  );
}

export function startJobs(
  jobs: Jobs,
  tenants: Tenants,
  deps: Deps,
  instance: string | undefined,
  handlers: JobHandlers,
  bucket?: Bucket,
  onActivity?: () => Promise<void>,
): (release?: boolean) => Promise<void> {
  const registry = new Map(Object.entries(handlers));
  if (registry.size === 0) return async () => {};
  const kinds = [...registry.keys()];
  let leaseOwner: string | undefined;
  let stopped = false;
  let pending = false;
  let active: Promise<number | null> | undefined;
  let currentJob: string | undefined;

  async function run(owner: string, instanceId: string) {
    while (!stopped) {
      const lease = { instanceId: owner, claimedAt: deps.now() };
      const claim = await jobs.claim(kinds, lease);
      if (stopped) return null;
      if (!claim.job) return claim.nextDue;
      const handler = registry.get(claim.job.kind);
      if (!handler) continue;
      currentJob = claim.job.id;
      await runLoggedEffect(tenants, handler, claim.job, lease, deps, instanceId, bucket).finally(() => {
        currentJob = undefined;
      });
      if (!stopped) await onActivity?.();
    }
    return null;
  }
  async function drain(owner: string) {
    const instanceId = instance ?? owner;
    try {
      let nextDue: number | null;
      do {
        pending = false;
        try {
          nextDue = await run(owner, instanceId);
        } catch (error) {
          deps.log.error("job claim failed", { instanceId, error: errorMessage(error) });
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
    // A replacement can reuse the configured instance label while the old owner drains.
    leaseOwner ??= deps.requestId();
    active ??= drain(leaseOwner);
    return active;
  });
  return async (release = false) => {
    stopped = true;
    stop();
    const running = active;
    const owner = leaseOwner;
    if (owner === undefined) return;
    const instanceId = instance ?? owner;
    // An unfinished job must keep its lease. Return any others even if the current job hits the shutdown cap.
    if (release) await releaseLeases(jobs, deps, owner, instanceId, currentJob);
    await running;
    // A claim might have finished during shutdown, or the current effect might have rolled back.
    if (release && running) await releaseLeases(jobs, deps, owner, instanceId);
  };
}

async function runLoggedEffect(
  tenants: Tenants,
  handler: JobHandler | OrgJobHandler | ExternalBoardJobHandler,
  job: Job,
  lease: JobLease,
  deps: Deps,
  instanceId: string,
  bucket?: Bucket,
) {
  try {
    const ran = await runEffect(tenants, handler, job, lease, deps.now, bucket);
    if (ran) deps.log.info("job completed", { kind: job.kind, instanceId });
  } catch (error) {
    // Leave the lease to expire. An unsuccessful transaction rolls back both consumption and the effect.
    deps.log.error("job failed", { kind: job.kind, instanceId, error: errorMessage(error) });
  }
}

function runEffect(
  tenants: Tenants,
  handler: JobHandler | OrgJobHandler | ExternalBoardJobHandler,
  job: Job,
  lease: JobLease,
  now: () => number,
  bucket?: Bucket,
): Promise<boolean> {
  if (typeof handler !== "function") {
    if ("runBoard" in handler) return handler.runBoard(tenants.jobBoard(job), job, lease);
    return handler.run(tenants.jobOrg(job), job, lease, now(), bucket);
  }
  return tenants.jobBoard(job).write(async (writer) => {
    const takenAt = now();
    const payload = await writer.takeJob(job.id, lease, takenAt);
    if (payload === null) return false;
    await handler(writer, payload, Math.max(takenAt, lease.claimedAt));
    return true;
  });
}

async function releaseLeases(jobs: Jobs, deps: Deps, leaseOwner: string, instanceId: string, exceptId?: string) {
  try {
    await jobs.release(leaseOwner, deps.now(), exceptId);
  } catch (error) {
    deps.log.error("job lease release failed", { instanceId, error: errorMessage(error) });
  }
}
