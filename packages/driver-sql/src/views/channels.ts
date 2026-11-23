import type { BoardScope, BoardView, ChannelsQuery } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { query, sql } from "../sql.ts";

/**
 * The page's filters sit in the join, so the board's row (and its head) comes back even when no channel matches.
 * An absent prefix or `after` is bound as "": every path starts with it and sorts after it.
 */
export const channelStatements = {
  listChannels: sql`SELECT boards.head, channels.path, channels.last_index, channels.messages, channels.threads
    FROM boards LEFT JOIN channels ON channels.board_id = boards.id AND channels.path > ${"after"}
      AND substr(channels.path, 1, ${"prefixLength"}) = ${"prefix"}
    WHERE boards.id = ${"boardId"} AND boards.org_id = ${"orgId"} ORDER BY channels.path LIMIT ${"limit"}`,
};

/** Read the counts and the board head from the same snapshot, including for an empty board. */
export function channelReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "listChannels"> {
  return {
    async listChannels({ prefix = "", after = "", limit }: ChannelsQuery) {
      const rows = await query(db, dialect, channelStatements.listChannels, {
        after,
        prefixLength: [...prefix].length,
        prefix,
        boardId: scope.boardId,
        orgId: scope.orgId,
        limit,
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
