import type { BoardScope, BoardView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { query, sql } from "../sql.ts";

export const channelStatements = {
  listChannels: sql`SELECT boards.head, channels.path, channels.last_index, channels.messages, channels.threads
    FROM boards LEFT JOIN channels ON channels.board_id = boards.id
    WHERE boards.id = ${"boardId"} AND boards.org_id = ${"orgId"} ORDER BY channels.path`,
};

/** Read the counts and the board head from the same snapshot, including for an empty board. */
export function channelReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "listChannels"> {
  return {
    async listChannels() {
      const rows = await query(db, dialect, channelStatements.listChannels, {
        boardId: scope.boardId,
        orgId: scope.orgId,
      });
      const channels = rows.flatMap((row) =>
        typeof row.path === "string"
          ? [
              {
                path: row.path,
                lastIndex: Number(row.last_index ?? 0),
                messages: Number(row.messages),
                threads: Number(row.threads),
              },
            ]
          : [],
      );
      return { channels, head: Number(rows[0]?.head ?? 0) };
    },
  };
}
