import type { Attachment } from "@openboard/contract";
import { checkStoredBytes, dailyEventWindow } from "@openboard/core";
import {
  type AttachmentReads,
  type AttachmentRecord,
  BLOB_GC_JOB,
  type BlobKey,
  type Blobs,
  type BoardKeys,
  type BoardView,
} from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { type Fragment, query, sql } from "../../sql.ts";
import { lockBoard } from "../boards.ts";
import { type JobWrites, jobWriter } from "../jobs/index.ts";

const backfillBatchSize = 100;
const attachmentLifetime = 24 * 60 * 60 * 1_000;
const boardLock: Fragment = { fragment: ({ lockSuffix }) => lockSuffix };

const orgLock: Fragment = { fragment: ({ name }) => (name === "postgres" ? " FOR UPDATE OF o" : "") };
const ids: Fragment = {
  fragment: ({ name }) =>
    name === "postgres" ? "jsonb_array_elements_text(input.data::jsonb)" : "json_each(input.data)",
};

export const attachmentStatements = {
  attachmentsForPost: sql`SELECT DISTINCT a.id, a.name, a.type, a.size, a.uploader, a.sha256, m.channel
    FROM (SELECT CAST(${"ids"} AS TEXT) AS data) input JOIN ${ids} wanted ON TRUE
    JOIN attachments a ON a.id = wanted.value
    LEFT JOIN (terms t JOIN messages m ON m.org_id = t.org_id AND m.board_id = t.board_id
      AND m.id = t.message AND m.deleted = 0)
      ON t.org_id = a.org_id AND t.board_id = a.board_id AND t.term = '^' AND t.value = a.id
    WHERE a.org_id = ${"orgId"} AND a.board_id = ${"boardId"}`,
  attachmentLockOrg: sql`SELECT o.id FROM boards b JOIN orgs o ON o.id = b.org_id
    WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"}${orgLock}`,
  lockAttachmentBoard: sql`SELECT id FROM boards WHERE org_id = ${"orgId"} AND id = ${"boardId"}${boardLock}`,
  markLegacyAttachments: sql`UPDATE attachments SET gc_enqueued = 1
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id IN (
      SELECT id FROM attachments WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}
        AND attached = 0 AND gc_enqueued IS NULL ORDER BY id LIMIT ${"limit"}
    ) RETURNING id, at`,
  deleteUnattached: sql`DELETE FROM attachments WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}
    AND id = ${"id"} AND attached = 0 AND at <= ${"cutoff"} RETURNING sha256, size`,
  attachmentAlreadyStored: sql`SELECT 1 FROM attachments WHERE org_id = ${"orgId"} AND sha256 = ${"sha256"} LIMIT 1`,
  adjustStoredAttachmentBytes: sql`UPDATE orgs SET attachment_bytes = COALESCE(attachment_bytes, 0) + ${"size"}
    FROM boards b WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"} AND orgs.id = b.org_id`,
  insertAttachment: sql`INSERT INTO attachments (org_id, board_id, id, blob_key, sha256, name, type, size, uploader, at, gc_enqueued)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"key"}, ${"sha256"}, ${"name"}, ${"type"}, ${"size"}, ${"uploader"}, ${"at"}, 1)`,
  markAttachment: sql`UPDATE attachments SET attached = 1 WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}
    AND id = ${"id"} AND attached = 0`,
  insertAttachmentTerm: sql`INSERT INTO terms (org_id, board_id, message, term, value)
    VALUES (${"orgId"}, ${"boardId"}, ${"message"}, '^', ${"id"}) ON CONFLICT (board_id, message, term, value) DO NOTHING`,
  insertBlob: sql`INSERT INTO blobs (org_id, sha256, size, data, at)
    VALUES (${"orgId"}, ${"sha256"}, ${"size"}, ${"data"}, ${"at"}) ON CONFLICT (org_id, sha256) DO NOTHING`,
  deleteBlob: sql`DELETE FROM blobs WHERE org_id = ${"orgId"} AND sha256 = ${"sha256"}`,
  getBlob: sql`SELECT data FROM blobs WHERE org_id = ${"orgId"} AND sha256 = ${"sha256"}`,
};

export function attachmentReads(db: Db, dialect: Dialect, keys: BoardKeys): AttachmentReads {
  return {
    async attachments(ids) {
      const rows = await query(db, dialect, attachmentStatements.attachmentsForPost, {
        ...keys,
        ids: JSON.stringify(ids),
      });
      const found = new Map<string, AttachmentRecord & { channels: string[] }>();
      for (const row of rows) {
        const id = String(row.id);
        let item = found.get(id);
        if (!item) {
          const attachment: Attachment = { id, name: String(row.name), type: String(row.type), size: Number(row.size) };
          item = {
            attachment,
            key: { orgId: keys.orgId, sha256: String(row.sha256) },
            uploader: String(row.uploader),
            channels: [],
          };
          found.set(id, item);
        }
        if (typeof row.channel === "string") item.channels.push(row.channel);
      }
      return [...found.values()];
    },
  };
}

async function blobReferenced(db: Db, dialect: Dialect, key: BlobKey) {
  const [reference] = await query(db, dialect, attachmentStatements.attachmentAlreadyStored, { ...key });
  return reference !== undefined;
}

export function attachmentWrites(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
  blobs: (tx: Db) => Blobs,
  jobs: JobWrites,
): Pick<BoardView, "uploadAttachment" | "collectAttachment"> {
  return {
    async uploadAttachment(attachment, sha256, uploader, bytes, at) {
      const dueAt = at + attachmentLifetime;
      await db.transaction(async (tx) => {
        // Serialize organization-wide byte charges, including across boards, with message writes.
        await query(tx, dialect, attachmentStatements.attachmentLockOrg, keys);
        const { storage } = await lockBoard(tx, dialect, keys, null, dailyEventWindow(at), null);
        const key = { orgId: keys.orgId, sha256 };
        const existing = await blobReferenced(tx, dialect, key);
        checkStoredBytes(storage.boardBytes + storage.otherBytes, existing ? 0 : attachment.size, storage.limit);
        // A waiting message write follows the updated locked org row even if its board head did not move.
        if (!existing)
          await query(tx, dialect, attachmentStatements.adjustStoredAttachmentBytes, {
            ...keys,
            size: attachment.size,
          });
        await query(tx, dialect, attachmentStatements.insertAttachment, {
          ...keys,
          ...attachment,
          sha256,
          uploader,
          at,
          key: `org/${keys.orgId}/sha256/${sha256}`,
        });
        await jobWriter(tx, dialect, keys, () => {}).enqueue(BLOB_GC_JOB, dueAt, { id: attachment.id });
        await blobs(tx).put(key, bytes, at);
      });
      jobs.committed(BLOB_GC_JOB, dueAt);
    },
    collectAttachment(jobId, lease) {
      return db.transaction(async (tx) => {
        // Match the upload lock order so another board cannot acquire a reference during collection.
        await query(tx, dialect, attachmentStatements.attachmentLockOrg, keys);
        await query(tx, dialect, attachmentStatements.lockAttachmentBoard, keys);
        const now = Math.max(jobs.now(), lease.claimedAt);
        const queue = jobWriter(tx, dialect, keys, () => {});
        const payload = await queue.takeJob(jobId, lease, now);
        if (!payload) return false;
        if (payload.backfill === true) {
          await backfillAttachments(tx, dialect, keys, queue, now);
        } else if (dialect.name === "sqlite" && typeof payload.sha256 === "string") {
          const key = { orgId: keys.orgId, sha256: payload.sha256 };
          if (!(await blobReferenced(tx, dialect, key))) await blobs(tx).delete(key);
        } else {
          if (typeof payload.id !== "string") throw new Error("invalid blob GC job");
          await expireAttachment(tx, dialect, keys, blobs, queue, payload.id, now);
        }
        return true;
      });
    },
  };
}

async function backfillAttachments(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  queue: ReturnType<typeof jobWriter>,
  now: number,
) {
  const uploads = await query(tx, dialect, attachmentStatements.markLegacyAttachments, {
    ...keys,
    limit: backfillBatchSize,
  });
  for (const upload of uploads) {
    await queue.enqueue(BLOB_GC_JOB, Number(upload.at) + attachmentLifetime, { id: String(upload.id) });
  }
  if (uploads.length === backfillBatchSize) await queue.enqueue(BLOB_GC_JOB, now, { backfill: true });
}

async function expireAttachment(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  blobs: (tx: Db) => Blobs,
  queue: ReturnType<typeof jobWriter>,
  id: string,
  now: number,
) {
  const [deleted] = await query(tx, dialect, attachmentStatements.deleteUnattached, {
    ...keys,
    id,
    cutoff: now - attachmentLifetime,
  });
  if (!deleted) return;
  const key = { orgId: keys.orgId, sha256: String(deleted.sha256) };
  if (await blobReferenced(tx, dialect, key)) return;
  await query(tx, dialect, attachmentStatements.adjustStoredAttachmentBytes, { ...keys, size: -Number(deleted.size) });
  // Commit the row deletion before unlinking a SQLite file. On crash, this job can retry safely.
  if (dialect.name === "sqlite") await queue.enqueue(BLOB_GC_JOB, now, { sha256: key.sha256 });
  else await blobs(tx).delete(key);
}

export async function foldAttachments(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  message: number,
  attachments: readonly Attachment[],
) {
  for (const { id } of attachments) {
    const params = { ...keys, message, id };
    await query(tx, dialect, attachmentStatements.markAttachment, params);
    await query(tx, dialect, attachmentStatements.insertAttachmentTerm, params);
  }
}
