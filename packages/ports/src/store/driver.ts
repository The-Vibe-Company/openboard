import type { Blobs } from "../attachments/blobs.ts";
import type { Bucket } from "../bucket.ts";
import type { Jobs } from "../jobs.ts";
import type { BoardScope, BoardView, OrgScope, OrgView, PlatformView } from "../store.ts";

/** Ensure an archive exists, returning false when another instance holds the dump lock. */
export type DatabaseDump = (bucket: Bucket, key: string, signal: AbortSignal) => Promise<boolean>;

export type WebhookOutcome = "done" | "retry" | "dead" | "skipped";

export interface StoreMetrics {
  readonly boardLock: (ms: number) => void;
  readonly webhook: (outcome: WebhookOutcome) => void;
}

export interface Store {
  readonly blobs: Blobs;
  /** Observe this driver's board lock acquisitions and committed webhook outcomes. */
  observeMetrics?(metrics: StoreMetrics): void;
  readonly jobs: Jobs;
  readonly dumpIfMissing?: DatabaseDump;
  /** Query storage and report whether its schema meets this instance's migration level. */
  schemaReady(): Promise<boolean>;
  platform(): PlatformView;
  board(scope: BoardScope): BoardView;
  org(scope: OrgScope): OrgView;
  close(): Promise<void>;
}
