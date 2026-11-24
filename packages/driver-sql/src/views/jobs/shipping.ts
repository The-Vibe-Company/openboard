import { ORG_PURGE_RETENTION_MS } from "@openboard/core";
import type { OrgScope, OrgView, PlatformView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { type Fragment, query, sql } from "../../sql.ts";

const lockOrg: Fragment = { fragment: ({ name }) => (name === "postgres" ? " FOR UPDATE OF o" : "") };
const pageSize = 256;
const pagesPerStream = 4;
const uploadLeaseMs = 10_000;
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

function logEvent(row: Row) {
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

export function shippingView(db: Db, dialect: Dialect, { orgId }: OrgScope): Pick<OrgView, "shipLogs"> {
  const log = (tx: Db, boardId: number, shipped: number, end: number) =>
    query(tx, dialect, boardId === 0 ? s.shippingOrgLog : s.shippingBoardLog, {
      orgId,
      boardId,
      shipped,
      end,
      limit: pageSize,
    });

  function reserve(boardId: number, head: number, now: () => number) {
    return db.transaction(async (tx) => {
      const [org] = await query(tx, dialect, s.shippingLock, { orgId });
      if (!org) return;
      const at = now();
      if (org.deleted_at != null && at >= Number(org.deleted_at) + ORG_PURGE_RETENTION_MS - purgeGraceMs) return;
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

  return {
    async shipLogs(upload, stopped, now) {
      const [org] = await query(db, dialect, s.shippingOrgHead, { orgId });
      const boards = await query(db, dialect, s.shippingBoards, { orgId });
      for (const { id, head } of [...(org ? [{ id: 0, head: org.head }] : []), ...boards]) {
        const boardId = Number(id);
        for (let page = 0; page < pagesPerStream && !stopped(); page++) {
          const attempt = await reserve(boardId, Number(head), now);
          if (!attempt) break;
          const { rows, deadline, first, last } = attempt;
          if (stopped() || now() >= deadline) return;
          await upload({ boardId: boardId || null, deadline, first, last, events: rows.map(logEvent) });
          await query(db, dialect, s.shippingAdvance, { orgId, boardId, deadline });
          if (last >= Number(head)) break;
        }
      }
    },
  };
}
