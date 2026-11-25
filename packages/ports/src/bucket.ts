import type { BlobKey } from "./attachments/blobs.ts";
import type { JobLease } from "./jobs.ts";

/** A private backup bucket. Keys and prefixes are relative to its root. */
export interface Bucket {
  exists(key: string, deadline: number): Promise<boolean>;
  read(key: string): Promise<ReadableStream<Uint8Array> | null>;
  delete(key: string): Promise<void>;
  put(key: string, bytes: Uint8Array, deadline: number, contentType?: string): Promise<void>;
  /** Publish only after the stream ends successfully. */
  putStream(key: string, stream: ReadableStream<Uint8Array>): Promise<void>;
  list(prefix: string): AsyncIterable<string>;
  deletePrefix(prefix: string): Promise<void>;
}

export interface BackupAttachment extends BlobKey {
  readonly boardId: number;
  readonly id: string;
  readonly uploader: string;
  readonly at: number;
  readonly gcEnqueued: number | null;
  readonly shippedAt: number;
}

export interface LogSegment {
  /** Null for the organization log. */
  readonly boardId: number | null;
  readonly first: number;
  readonly last: number;
  readonly deadline: number;
  readonly events: readonly object[];
}

export interface OrgLogMaintenance {
  /** Consume the purge lease and remove the soft-deleted organization’s data atomically. */
  purgeOrg(
    boardId: number,
    jobId: string,
    lease: JobLease,
    now: number,
    deleteBackup?: () => Promise<void>,
  ): Promise<boolean>;
  /** Deliver pending log segments. The store serializes delivery and purge, and advances only after upload. */
  shipLogs(
    upload: (segment: LogSegment) => Promise<void>,
    stopped: () => boolean,
    now: () => number,
    uploadAttachment?: (attachment: BackupAttachment, deadline: number) => Promise<void>,
  ): Promise<void>;
}
