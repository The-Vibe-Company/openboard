import type { Channel } from "@openboard/contract";
import type { ChannelCreated } from "@openboard/core";
import type { BoardKeys, BoardScope, BoardView, ChannelsQuery } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { type Fragment, query, sql } from "../sql.ts";

/** Paths compare and sort by code point on both engines (Postgres's built-in `ucs_basic`), as SQLite and upstream do. */
const codePointOrder: Fragment = Object.freeze({
  fragment: (dialect: Dialect) => (dialect.name === "postgres" ? " COLLATE ucs_basic" : ""),
});

/**
 * The page's filters sit in the join, so the board's row (and its head) comes back even when no channel matches.
 * An absent prefix or `after` is bound as "": every path starts with it and sorts after it.
 */
export const channelStatements = {
  findChannel: sql`SELECT path, last_index, messages, threads FROM channels
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND path = ${"path"}`,
  insertChannel: sql`INSERT INTO channels (org_id, board_id, path, created_at)
    VALUES (${"orgId"}, ${"boardId"}, ${"path"}, ${"at"})`,
  listChannels: sql`SELECT boards.head, channels.path, channels.last_index, channels.messages, channels.threads
    FROM boards LEFT JOIN channels ON channels.board_id = boards.id AND channels.path${codePointOrder} > ${"after"}
      AND substr(channels.path, 1, ${"prefixLength"}) = ${"prefix"}
    WHERE boards.id = ${"boardId"} AND boards.org_id = ${"orgId"} ORDER BY channels.path${codePointOrder} LIMIT ${"limit"}`,
};

function channelView(row: Row): Channel | null {
  if (typeof row.path !== "string") return null;
  return {
    path: row.path,
    lastIndex: Number(row.last_index ?? 0),
    messages: Number(row.messages),
    threads: Number(row.threads),
  };
}

export async function findChannel(tx: Db, dialect: Dialect, keys: BoardKeys, path: string): Promise<Channel | null> {
  const [row] = await query(tx, dialect, channelStatements.findChannel, { ...keys, path });
  return row ? channelView(row) : null;
}

export async function foldChannelCreated(tx: Db, dialect: Dialect, keys: BoardKeys, event: ChannelCreated) {
  await query(tx, dialect, channelStatements.insertChannel, { ...keys, path: event.channel, at: event.at });
}

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
      const channels = rows.map(channelView).filter((channel) => channel !== null);
      return { channels, head: Number(rows[0]?.head ?? 0) };
    },
  };
}
