import type { BoardKeys } from "./store.ts";

export const TASK_EXPIRY_JOB = "task-expiry";
export const BACKFILL_BOARD_ORG_JOB = "backfill-board-org";
export const PURGE_ORG_JOB = "purge-org";

export interface Job extends BoardKeys {
  readonly id: string;
  readonly kind: string;
}

export interface JobLease {
  readonly instanceId: string;
  readonly claimedAt: number;
}

export type JobSchedule = (delayMs: number, run: () => void | Promise<void>) => () => void;

export type JobClaim = { readonly job: Job } | { readonly job: null; readonly nextDue: number | null };

/** Cross-board dispatch exposes routing metadata only. Effects re-enter the scoped board writer. */
export interface Jobs {
  claim(kinds: readonly string[], lease: JobLease): Promise<JobClaim>;
  /** Make this runner’s outstanding leases due immediately, optionally protecting its current job. */
  release(instanceId: string, now: number, exceptId?: string): Promise<void>;
  watch(kinds: readonly string[], schedule: JobSchedule, wake: () => Promise<number | null>): () => void;
}

export type JobPayload = Readonly<Record<string, unknown>>;

export interface BoardJobWriter {
  enqueue(kind: string, dueAt: number, payload: JobPayload): Promise<void>;
  /** Read the payload of the live lease without consuming it. */
  readJob(id: string, lease: JobLease, now: number): Promise<JobPayload | null>;
  /** Consume the live lease in this transaction. An effect that throws rolls consumption back as well. */
  takeJob(id: string, lease: JobLease, now: number): Promise<JobPayload | null>;
}
