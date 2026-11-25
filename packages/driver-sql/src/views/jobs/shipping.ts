import { type MessagePosted, ORG_PURGE_RETENTION_MS, type ScheduleCreated } from "@openboard/core";
import type { BackupAttachment, OrgScope, OrgView, PlatformView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { type Fragment, query, sql } from "../../sql.ts";

const lockOrg: Fragment = { fragment: ({ name }) => (name === "postgres" ? " FOR UPDATE OF o" : "") };
const attachmentIds: Fragment = {
  fragment: ({ name }) =>
    name === "postgres" ? "jsonb_array_elements_text(input.data::jsonb)" : "json_each(input.data)",
};
const pageSize = 256;
const pagesPerStream = 4;
const blobPageSize = 16;
// Positive board IDs and zero track event streams. This slot fences blob uploads against other runners.
const blobStream = -1;
const uploadLeaseMs = 10_000;
const blobRetryMs = 10_000;
// A persisted deletion stops new attempts before the purge job is eligible, even if a database connection dies.
const purgeGraceMs = 60_000;
const s = {
  shippingOrgs: sql`SELECT o.id FROM orgs o WHERE o.id > ${"after"} AND o.purged_at IS NULL
    AND (EXISTS (
      SELECT 1 FROM boards b LEFT JOIN shipping s ON s.org_id = b.org_id AND s.board_id = b.id
      WHERE b.org_id = o.id AND b.head > COALESCE(s.shipped, 0)
    ) OR EXISTS (
      SELECT 1 FROM org_events e LEFT JOIN shipping s ON s.org_id = e.org_id AND s.board_id = 0
      WHERE e.org_id = o.id AND e.id > COALESCE(s.shipped, 0)
    ) OR EXISTS (
      SELECT 1 FROM attachments a WHERE a.org_id = o.id AND a.backup_shipped_at IS NULL
    )) ORDER BY o.id LIMIT ${"limit"}`,
  shippingLock: sql`SELECT o.deleted_at FROM boards b JOIN orgs o ON o.id = b.org_id
    WHERE b.org_id = ${"orgId"} AND o.purged_at IS NULL ORDER BY b.id LIMIT 1${lockOrg}`,
  shippingBoards: sql`SELECT b.id, b.head FROM boards b
    LEFT JOIN shipping s ON s.org_id = b.org_id AND s.board_id = b.id
    WHERE b.org_id = ${"orgId"} AND b.head > COALESCE(s.shipped, 0) ORDER BY b.id`,
  shippingOrgHead: sql`SELECT e.id AS head FROM org_events e
    LEFT JOIN shipping s ON s.org_id = e.org_id AND s.board_id = 0
    WHERE e.org_id = ${"orgId"} AND e.id > COALESCE(s.shipped, 0) ORDER BY e.id DESC LIMIT 1`,
  shippingCursor: sql`SELECT shipped, pending, upload_until FROM shipping WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}`,
  shippingReserve: sql`INSERT INTO shipping (org_id, board_id, shipped, pending, upload_until)
    VALUES (${"orgId"}, ${"boardId"}, ${"shipped"}, ${"pending"}, ${"deadline"})
    ON CONFLICT (org_id, board_id) DO UPDATE
    SET shipped = excluded.shipped, pending = excluded.pending, upload_until = excluded.upload_until`,
  shippingAdvance: sql`UPDATE shipping SET shipped = pending, upload_until = 0
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND upload_until = ${"deadline"}`,
  shippingBoardLog: sql`SELECT id, type, v, at, thread, message, channel, actor, principal, visibility, payload FROM events
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id > ${"shipped"} AND id <= ${"end"}
    ORDER BY id LIMIT ${"limit"}`,
  shippingPendingBlobs: sql`SELECT board_id, id, sha256, uploader, at, gc_enqueued FROM attachments
    WHERE org_id = ${"orgId"} AND backup_shipped_at IS NULL
    AND (backup_retry_at IS NULL OR backup_retry_at <= ${"now"})
    ORDER BY at, board_id, id LIMIT ${"limit"}`,
  shippingLogBlobs: sql`SELECT a.board_id, a.id, a.sha256, a.uploader, a.at, a.gc_enqueued, a.backup_retry_at FROM (SELECT CAST(${"ids"} AS TEXT) AS data) input
    JOIN ${attachmentIds} wanted ON TRUE JOIN attachments a ON a.id = wanted.value
    WHERE a.org_id = ${"orgId"} AND a.board_id = ${"boardId"} AND a.backup_shipped_at IS NULL`,
  shippingMarkBlob: sql`UPDATE attachments SET backup_shipped_at = ${"at"}, backup_retry_at = NULL
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"} AND backup_shipped_at IS NULL`,
  shippingRetryBlob: sql`UPDATE attachments SET backup_retry_at = ${"at"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"} AND backup_shipped_at IS NULL`,
  shippingOrgLog: sql`SELECT id, type, at, actor, payload FROM org_events
    WHERE org_id = ${"orgId"} AND id > ${"shipped"} AND id <= ${"end"} ORDER BY id LIMIT ${"limit"}`,
};

export const shippingStatements = s;

export function shippingPlatform(db: Db, dialect: Dialect): Pick<PlatformView, "shippingOrgs"> {
  return {
    async shippingOrgs(after, limit) {
      return (await query(db, dialect, s.shippingOrgs, { after, limit })).map(({ id }) => Number(id));
    },
  };
}

export function logEvent(row: Row) {
  return {
    ...row,
    id: Number(row.id),
    at: Number(row.at),
    ...("v" in row && {
      v: Number(row.v),
      visibility: Number(row.visibility),
      thread: row.thread == null ? null : Number(row.thread),
      message: row.message == null ? null : Number(row.message),
    }),
    payload: JSON.parse(String(row.payload)) as unknown,
  };
}

function attachmentBackup(row: Row, orgId: number, shippedAt: number): BackupAttachment {
  return {
    orgId,
    boardId: Number(row.board_id),
    id: String(row.id),
    sha256: String(row.sha256),
    uploader: String(row.uploader),
    at: Number(row.at),
    gcEnqueued: row.gc_enqueued === null ? null : Number(row.gc_enqueued),
    shippedAt,
  };
}

function referencedAttachments(events: ReturnType<typeof logEvent>[]) {
  const ids = new Set<string>();
  for (const event of events) {
    if (!("type" in event)) continue;
    if (event.type === "message.posted")
      for (const { id } of (event.payload as MessagePosted["payload"]).attachments ?? []) ids.add(id);
    if (event.type === "ob.schedule.created")
      for (const id of (event.payload as ScheduleCreated["payload"]).attachments ?? []) ids.add(id);
  }
  return ids;
}

function blobShipper(
  db: Db,
  dialect: Dialect,
  orgId: number,
  leaseTime: (tx: Db, now: () => number) => Promise<number | undefined>,
) {
  const blobKeys = { orgId, boardId: blobStream };

  function reserveBlobs(now: () => number) {
    return db.transaction(async (tx) => {
      const at = await leaseTime(tx, now);
      if (at === undefined) return;
      const [cursor] = await query(tx, dialect, s.shippingCursor, blobKeys);
      if (Number(cursor?.upload_until ?? 0) > at) return;
      const rows = await query(tx, dialect, s.shippingPendingBlobs, { orgId, now: at, limit: blobPageSize });
      const deadline = at + uploadLeaseMs;
      if (rows.length) {
        await query(tx, dialect, s.shippingReserve, { ...blobKeys, shipped: 0, pending: 0, deadline });
      }
      return { rows, deadline };
    });
  }

  type Upload = (attachment: BackupAttachment, deadline: number) => Promise<void>;
  async function shipRow(row: Row, deadline: number, upload: Upload, now: () => number) {
    const backup = attachmentBackup(row, orgId, now());
    const { boardId, id, shippedAt } = backup;
    const keys = { orgId, boardId, id };
    try {
      await upload(backup, deadline);
    } catch {
      await query(db, dialect, s.shippingRetryBlob, { ...keys, at: now() + blobRetryMs });
      return false;
    }
    await query(db, dialect, s.shippingMarkBlob, { ...keys, at: shippedAt });
    return true;
  }

  async function shipPending(upload: Upload, stopped: () => boolean, now: () => number) {
    let failed = false;
    while (!stopped()) {
      const batch = await reserveBlobs(now);
      if (!batch?.rows.length) break;
      for (const row of batch.rows) {
        if (stopped() || now() >= batch.deadline) break;
        if (!(await shipRow(row, batch.deadline, upload, now))) failed = true;
      }
      await query(db, dialect, s.shippingAdvance, { ...blobKeys, deadline: batch.deadline });
    }
    return failed;
  }

  async function shipReferenced(
    boardId: number,
    events: ReturnType<typeof logEvent>[],
    deadline: number,
    upload: Upload,
    stopped: () => boolean,
    now: () => number,
  ) {
    const ids = referencedAttachments(events);
    if (!ids.size) return true;
    const rows = await query(db, dialect, s.shippingLogBlobs, { orgId, boardId, ids: JSON.stringify([...ids]) });
    for (const row of rows) {
      const at = now();
      if (stopped() || at >= deadline || Number(row.backup_retry_at ?? 0) > at) return false;
      if (!(await shipRow(row, deadline, upload, now))) throw new Error("Referenced attachment backup failed");
    }
    return true;
  }

  return { shipPending, shipReferenced };
}

export function shippingView(db: Db, dialect: Dialect, { orgId }: OrgScope): Pick<OrgView, "shipLogs"> {
  const log = (tx: Db, boardId: number, shipped: number, end: number) =>
    query(tx, dialect, boardId === 0 ? s.shippingOrgLog : s.shippingBoardLog, {
      orgId,
      boardId,
      shipped,
      end,
      limit: pageSize,
    });

  async function leaseTime(tx: Db, now: () => number) {
    const [org] = await query(tx, dialect, s.shippingLock, { orgId });
    if (!org) return;
    const at = now();
    if (org.deleted_at != null && at >= Number(org.deleted_at) + ORG_PURGE_RETENTION_MS - purgeGraceMs) return;
    return at;
  }

  function reserve(boardId: number, head: number, now: () => number) {
    return db.transaction(async (tx) => {
      const at = await leaseTime(tx, now);
      if (at === undefined) return;
      const keys = { orgId, boardId };
      const [cursor] = await query(tx, dialect, s.shippingCursor, keys);
      const shipped = Number(cursor?.shipped ?? 0);
      if (Number(cursor?.upload_until ?? 0) > at || head <= shipped) return;
      const pending = Number(cursor?.pending ?? 0);
      const rows = await log(tx, boardId, shipped, pending > shipped ? pending : head);
      const last = pending > shipped ? pending : Number(rows.at(-1)?.id ?? head);
      const deadline = at + uploadLeaseMs;
      await query(tx, dialect, s.shippingReserve, {
        ...keys,
        shipped: rows.length ? shipped : last,
        pending: last,
        deadline: rows.length ? deadline : 0,
      });
      if (rows.length) return { rows, deadline, first: shipped + 1, last };
    });
  }

  const blobs = blobShipper(db, dialect, orgId, leaseTime);

  return {
    async shipLogs(upload, stopped, now, uploadAttachment) {
      const [org] = await query(db, dialect, s.shippingOrgHead, { orgId });
      const boards = await query(db, dialect, s.shippingBoards, { orgId });
      let attachmentFailed = false;
      for (const { id, head } of [...(org ? [{ id: 0, head: org.head }] : []), ...boards]) {
        const boardId = Number(id);
        for (let page = 0; page < pagesPerStream && !stopped(); page++) {
          const attempt = await reserve(boardId, Number(head), now);
          if (!attempt) break;
          const { rows, deadline, first, last } = attempt;
          const events = rows.map(logEvent);
          if (uploadAttachment) {
            try {
              if (!(await blobs.shipReferenced(boardId, events, deadline, uploadAttachment, stopped, now))) break;
            } catch {
              // Keep this range reserved for retry, but let other boards publish their own ranges.
              attachmentFailed = true;
              break;
            }
          }
          if (stopped() || now() >= deadline) return;
          await upload({ boardId: boardId || null, deadline, first, last, events });
          await query(db, dialect, s.shippingAdvance, { orgId, boardId, deadline });
          if (last >= Number(head)) break;
        }
      }
      const pendingFailed = uploadAttachment && (await blobs.shipPending(uploadAttachment, stopped, now));
      if (attachmentFailed || pendingFailed) throw new Error("Attachment backup failed");
    },
  };
}
