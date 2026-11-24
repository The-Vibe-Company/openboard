import type { AuditRecord, BoardScope, BoardView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { query, sql } from "../sql.ts";

/** One row per configuration event (visibility 2, `ob.*`), and the board's head; one row with no event when none. */
export const auditStatements = {
  auditEvents: sql`SELECT b.head, e.id, e.type, e.at, e.actor, e.principal, e.payload
    FROM boards b LEFT JOIN events e ON e.org_id = b.org_id AND e.board_id = b.id
      AND e.visibility = 2 AND e.id > ${"after"} AND e.id <= b.head
    WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"}
    ORDER BY e.id LIMIT ${"limit"}`,
};

function auditRecord(row: Row): AuditRecord {
  return {
    id: Number(row.id),
    type: String(row.type),
    at: Number(row.at),
    thread: null,
    message: null,
    channel: null,
    actor: String(row.actor),
    principal: String(row.principal),
    visibility: 2,
    payload: JSON.parse(String(row.payload)) as unknown,
  } as AuditRecord;
}

export function auditReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "auditEvents"> {
  return {
    async auditEvents(after, limit) {
      const rows = await query(db, dialect, auditStatements.auditEvents, {
        orgId: scope.orgId,
        boardId: scope.boardId,
        after,
        limit,
      });
      const first = rows[0];
      if (!first) throw new Error("the scoped board is missing");
      return { head: Number(first.head), events: rows.filter((row) => row.id != null).map(auditRecord) };
    },
  };
}
