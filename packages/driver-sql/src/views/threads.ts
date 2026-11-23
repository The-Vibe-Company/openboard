import type { Message } from "@openboard/contract";
import type { BoardScope, BoardView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { query, sql } from "../sql.ts";

export const threadStatements = {
  listThreads: sql`WITH recent AS (
      SELECT board_id, id, active, view, replies, last_reply FROM messages
      WHERE board_id = ${"boardId"} AND channel = ${"channel"} AND re IS NULL
      ORDER BY active DESC, id DESC LIMIT 50
    )
    SELECT boards.head, recent.view, recent.replies, reply.view AS last_view
    FROM boards LEFT JOIN recent ON recent.board_id = boards.id
    LEFT JOIN messages AS reply ON reply.board_id = boards.id AND reply.id = recent.last_reply
    WHERE boards.id = ${"boardId"} AND boards.org_id = ${"orgId"}
    ORDER BY recent.active, recent.id`,
  thread: sql`SELECT id, view FROM messages WHERE board_id = ${"boardId"} AND (id = ${"id"} OR re = ${"id"})
    ORDER BY id`,
};

/** The thread reads of one board's view: one statement reads the message and its replies together. */
export function threadReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "thread" | "listThreads"> {
  return {
    async listThreads(channel) {
      const rows = await query(db, dialect, threadStatements.listThreads, {
        boardId: scope.boardId,
        orgId: scope.orgId,
        channel,
      });
      const threads = rows.flatMap((row) =>
        row.view == null
          ? []
          : [
              {
                message: JSON.parse(String(row.view)) as Message,
                replies: Number(row.replies),
                last: row.last_view == null ? null : (JSON.parse(String(row.last_view)) as Message),
              },
            ],
      );
      return { threads, head: Number(rows[0]?.head ?? 0) };
    },
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
