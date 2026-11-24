import type { Attachment } from "@openboard/contract";

export interface BlobKey {
  readonly orgId: number;
  readonly sha256: string;
}

export interface Blobs {
  put(key: BlobKey, bytes: Uint8Array, at: number): Promise<void>;
  delete(key: BlobKey): Promise<void>;
  get(key: BlobKey): Promise<ReadableStream<Uint8Array> | null>;
}

export interface AttachmentRecord {
  readonly attachment: Attachment;
  readonly key: BlobKey;
  readonly uploader: string;
  readonly channels: readonly string[];
}

export interface AttachmentReads {
  attachments(ids: readonly string[]): Promise<AttachmentRecord[]>;
}

export interface AttachmentWrites {
  uploadAttachment(
    attachment: Attachment,
    sha256: string,
    uploader: string,
    bytes: Uint8Array,
    at: number,
  ): Promise<void>;
}
