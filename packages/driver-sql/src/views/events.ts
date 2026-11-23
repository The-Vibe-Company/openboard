import type { MessageDeleted, MessageEdited, MessagePosted } from "@openboard/core";
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

function messageEvent(row: Row): MessagePosted | MessageEdited | MessageDeleted {
  const common = {
    id: Number(row.id),
    at: Number(row.at),
    thread: Number(row.thread),
    message: Number(row.message),
    channel: String(row.channel),
    actor: String(row.actor),
    principal: String(row.principal),
    visibility: 0 as const,
  };
  const payload = JSON.parse(String(row.payload)) as unknown;
  if (row.type === "message.deleted")
    return { ...common, type: "message.deleted", payload: payload as MessageDeleted["payload"] };
  return row.type === "message.edited"
    ? { ...common, type: "message.edited", payload: payload as MessageEdited["payload"] }
    : { ...common, type: "message.posted", payload: payload as MessagePosted["payload"] };
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
      const events = rows.filter(
        (row) =>
          (row.type === "message.posted" || row.type === "message.edited" || row.type === "message.deleted") &&
          Number(row.visibility) === 0,
      );
      return { head, cursor, events: events.map(messageEvent) };
    },
  };
}
