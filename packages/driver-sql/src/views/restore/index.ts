import { type Attachment, BoardError } from "@openboard/contract";
import { type BoardEvent, dailyEventWindow } from "@openboard/core";
import { BLOB_GC_JOB, type BoardKeys } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { query, sql } from "../../sql.ts";
import { attachmentLifetime, attachmentStatements } from "../attachments/index.ts";
import { lockBoard, setHead } from "../boards.ts";
import { jobWriter } from "../jobs/index.ts";
import { shippingStatements } from "../jobs/shipping.ts";
import { appendEvent } from "../messages/fold.ts";
import { messageStorage } from "../messages/storage.ts";

export const restoreStatements = {
  restoreBoard: sql`SELECT b.head FROM boards b JOIN orgs o ON o.id = b.org_id
    WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"} AND o.slug = 'local' AND b.slug = 'main'`,
  restoreLatestEventTime: sql`SELECT MAX(at) AS at FROM events WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}`,
  restoreAttachment: sql`SELECT sha256 FROM attachments WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  restoreBlobs: sql`SELECT DISTINCT sha256 FROM attachments WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}`,
  restoreAttachmentMetadata: sql`UPDATE attachments SET gc_enqueued = ${"gcEnqueued"}, backup_shipped_at = ${"shippedAt"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
};

interface AttachmentBackup {
  sha256: string;
  uploader?: string;
  at?: number;
  gcEnqueued?: number | null;
  shippedAt?: number;
}

export type ReadAttachmentBackup = (id: string) => Promise<AttachmentBackup | null>;

async function restoreAttachment(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  attachment: Attachment,
  event: Extract<BoardEvent, { type: "message.posted" | "ob.schedule.created" }>,
  read: ReadAttachmentBackup,
) {
  const params = { ...keys, id: attachment.id };
  if ((await query(tx, dialect, restoreStatements.restoreAttachment, params)).length) return;
  const backup = await read(attachment.id);
  if (!backup) {
    // Old writers could ship a schedule before its unattached upload reached the bucket.
    if (event.type === "ob.schedule.created") return;
    throw new BoardError("invalid_request", `Missing backup attachment mapping ${attachment.id}`);
  }
  const { sha256, uploader = event.principal, at = event.at, gcEnqueued = 1, shippedAt = null } = backup;
  if (!(await query(tx, dialect, attachmentStatements.attachmentAlreadyStored, { ...keys, sha256 })).length)
    await query(tx, dialect, attachmentStatements.adjustStoredAttachmentBytes, { ...keys, size: attachment.size });
  await query(tx, dialect, attachmentStatements.insertAttachment, {
    ...keys,
    ...attachment,
    sha256,
    uploader,
    at,
    key: `org/${keys.orgId}/sha256/${sha256}`,
  });
  await query(tx, dialect, restoreStatements.restoreAttachmentMetadata, { ...params, gcEnqueued, shippedAt });
  if (event.type === "ob.schedule.created")
    await jobWriter(tx, dialect, keys, () => {}).enqueue(BLOB_GC_JOB, at + attachmentLifetime, { id: attachment.id });
}

/** Append decided events under the normal board lock, without command checks or external side effects. */
export async function replayBoard(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
  events: readonly BoardEvent[],
  read: ReadAttachmentBackup,
) {
  const first = events[0];
  if (!first) return;
  await db.transaction(async (tx) => {
    const locked = await lockBoard(tx, dialect, keys, null, dailyEventWindow(first.at), null);
    const usage = messageStorage(tx, dialect, keys, locked.storage, () => undefined, false);
    let { head } = locked;
    let { day, count } = locked.dailyEvents;
    for (const event of events) {
      if (event.id !== head + 1) throw new Error(`Missing event ${head + 1}`);
      if (event.type === "message.posted" || event.type === "ob.schedule.created") {
        const attachments =
          event.type === "message.posted" ? event.payload.attachments : event.payload.schedule.attachments;
        for (const attachment of attachments) await restoreAttachment(tx, dialect, keys, attachment, event, read);
      }
      await usage.account(event);
      await appendEvent(tx, dialect, keys, event);
      head = event.id;
      const window = dailyEventWindow(event.at);
      if (window.day > day) {
        day = window.day;
        count = 0;
      }
      if (event.type !== "ob.webhook.disabled") count++;
    }
    await setHead(tx, dialect, keys, head, usage.boardBytes, { day, count });
    await query(tx, dialect, shippingStatements.shippingReserve, {
      ...keys,
      shipped: head,
      pending: head,
      deadline: 0,
    });
  });
}
