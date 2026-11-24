import type { Attachment } from "@openboard/contract";
import { checkStoredBytes, dailyEventWindow } from "@openboard/core";
import type { AttachmentReads, AttachmentRecord, AttachmentWrites, Blobs, BoardKeys } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { type Fragment, query, sql } from "../../sql.ts";
import { lockBoard } from "../boards.ts";

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
  attachmentAlreadyStored: sql`SELECT 1 FROM attachments WHERE org_id = ${"orgId"} AND sha256 = ${"sha256"} LIMIT 1`,
  chargeStoredAttachment: sql`UPDATE orgs SET attachment_bytes = COALESCE(attachment_bytes, 0) + ${"size"}
    FROM boards b WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"} AND orgs.id = b.org_id`,
  insertAttachment: sql`INSERT INTO attachments (org_id, board_id, id, blob_key, sha256, name, type, size, uploader, at)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"key"}, ${"sha256"}, ${"name"}, ${"type"}, ${"size"}, ${"uploader"}, ${"at"})`,
  markAttachment: sql`UPDATE attachments SET attached = 1 WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}
    AND id = ${"id"} AND attached = 0`,
  insertAttachmentTerm: sql`INSERT INTO terms (org_id, board_id, message, term, value)
    VALUES (${"orgId"}, ${"boardId"}, ${"message"}, '^', ${"id"}) ON CONFLICT (board_id, message, term, value) DO NOTHING`,
  insertBlob: sql`INSERT INTO blobs (org_id, sha256, size, data, at)
    VALUES (${"orgId"}, ${"sha256"}, ${"size"}, ${"data"}, ${"at"}) ON CONFLICT (org_id, sha256) DO NOTHING`,
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

export function attachmentWrites(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
  blobs: (tx: Db) => Blobs,
): AttachmentWrites {
  return {
    uploadAttachment(attachment, sha256, uploader, bytes, at) {
      return db.transaction(async (tx) => {
        // Serialize organization-wide byte charges, including across boards, with message writes.
        await query(tx, dialect, attachmentStatements.attachmentLockOrg, keys);
        const { storage } = await lockBoard(tx, dialect, keys, null, dailyEventWindow(at), null);
        const key = { orgId: keys.orgId, sha256 };
        const [existing] = await query(tx, dialect, attachmentStatements.attachmentAlreadyStored, { ...key });
        checkStoredBytes(storage.boardBytes + storage.otherBytes, existing ? 0 : attachment.size, storage.limit);
        // A waiting message write follows the updated locked org row even if its board head did not move.
        if (!existing)
          await query(tx, dialect, attachmentStatements.chargeStoredAttachment, { ...keys, size: attachment.size });
        await blobs(tx).put(key, bytes, at);
        await query(tx, dialect, attachmentStatements.insertAttachment, {
          ...keys,
          ...attachment,
          sha256,
          uploader,
          at,
          key: `org/${keys.orgId}/sha256/${sha256}`,
        });
      });
    },
  };
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
