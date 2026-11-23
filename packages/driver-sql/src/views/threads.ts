import type { Message } from "@openboard/contract";
import type { BoardScope, BoardView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { query, sql } from "../sql.ts";

export const threadStatements = {
  thread: sql`SELECT id, view FROM messages WHERE board_id = ${"boardId"} AND (id = ${"id"} OR re = ${"id"})
    ORDER BY id`,
};

/** The thread reads of one board's view: one statement reads the message and its replies together. */
export function threadReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "thread"> {
  return {
    async thread(id) {
      const rows = await query(db, dialect, threadStatements.thread, { boardId: scope.boardId, id });
      const [first, ...rest] = rows.map((row) => ({
        id: Number(row.id),
        view: JSON.parse(String(row.view)) as Message,
      }));
      if (first?.id !== id) return null;
      return { message: first.view, replies: rest.map(({ view }) => view) };
    },
  };
}
