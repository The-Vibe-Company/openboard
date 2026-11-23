import type { MessagePosted } from "@openboard/core";
import type { BoardScope, BoardView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { query, sql } from "../sql.ts";

export const eventStatements = {
  readEvents: sql`SELECT b.head, e.id, e.type, e.at, e.thread, e.message, e.channel, e.actor, e.principal,
    e.visibility, e.payload
    FROM boards b LEFT JOIN events e ON e.org_id = b.org_id AND e.board_id = b.id
      AND e.id > COALESCE(${"after"}, b.head) AND e.id <= b.head
    WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"}
    ORDER BY e.id ASC LIMIT 200`,
};

function postedEvent(row: Row): MessagePosted {
  return {
    id: Number(row.id),
    type: "message.posted",
    at: Number(row.at),
    thread: Number(row.thread),
    message: Number(row.message),
    channel: String(row.channel),
    actor: String(row.actor),
    principal: String(row.principal),
    visibility: 0,
    payload: JSON.parse(String(row.payload)) as MessagePosted["payload"],
  };
}

export function eventReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "readEvents"> {
  return {
    async readEvents(after) {
      const rows = await query(db, dialect, eventStatements.readEvents, {
        orgId: scope.orgId,
        boardId: scope.boardId,
        after: after ?? null,
      });
      const first = rows[0];
      if (!first) throw new Error("the scoped board is missing");
      const head = Number(first.head);
      const cursor = Number(rows.at(-1)?.id ?? head);
      const events = rows.filter((row) => row.type === "message.posted" && Number(row.visibility) === 0);
      return { head, cursor, events: events.map(postedEvent) };
    },
  };
}
