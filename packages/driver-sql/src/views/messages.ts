import type { Message } from "@openboard/contract";
import { type BoardEvent, messages } from "@openboard/core";
import type { BoardKeys, BoardScope, BoardView, BoardWriter } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { query, sql } from "../sql.ts";
import { lockBoard, setHead } from "./boards.ts";

export const messageStatements = {
  insertEvent: sql`INSERT INTO events (org_id, board_id, id, type, at, thread, message, channel, actor, principal,
    visibility, payload) VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"type"}, ${"at"}, ${"thread"}, ${"message"},
    ${"channel"}, ${"actor"}, ${"principal"}, ${"visibility"}, ${"payload"})`,
  insertMessage: sql`INSERT INTO messages (org_id, board_id, id, channel, actor, principal, profile, text, text_lower,
    labels, no_sync, version, created_at, active, view) VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"channel"},
    ${"actor"}, ${"principal"}, ${"profile"}, ${"text"}, ${"textLower"}, ${"labels"}, ${"noSync"}, ${"id"}, ${"at"},
    ${"id"}, ${"view"})`,
  upsertChannel: sql`INSERT INTO channels (org_id, board_id, path, created_at, last_index, messages, threads)
    VALUES (${"orgId"}, ${"boardId"}, ${"path"}, ${"at"}, ${"id"}, 1, 1) ON CONFLICT (board_id, path)
    DO UPDATE SET last_index = excluded.last_index, messages = channels.messages + 1, threads = channels.threads + 1`,
  channelMessages: sql`SELECT view FROM messages WHERE board_id = ${"boardId"} AND channel = ${"channel"}
    ORDER BY id DESC LIMIT ${"limit"}`,
};

/** The fold of `message.posted` for a root: the message row with its precomputed view, and its channel's row. */
async function foldMessagePosted(tx: Db, dialect: Dialect, keys: BoardKeys, event: BoardEvent): Promise<void> {
  const { payload } = event;
  await query(tx, dialect, messageStatements.insertMessage, {
    ...keys,
    id: event.id,
    channel: payload.channel,
    actor: payload.by.actor,
    principal: payload.by.principal,
    profile: payload.by.profile,
    text: payload.text,
    textLower: payload.text.toLowerCase(),
    labels: JSON.stringify(payload.labels),
    noSync: payload.noSync ? 1 : 0,
    at: event.at,
    view: JSON.stringify(messages.messageView(event)),
  });
  await query(tx, dialect, messageStatements.upsertChannel, {
    ...keys,
    path: payload.channel,
    at: event.at,
    id: event.id,
  });
}

/** Appends one event to the log and folds it, in the caller's transaction. */
async function appendEvent(tx: Db, dialect: Dialect, keys: BoardKeys, event: BoardEvent): Promise<void> {
  await query(tx, dialect, messageStatements.insertEvent, {
    ...keys,
    id: event.id,
    type: event.type,
    at: event.at,
    thread: event.thread,
    message: event.message,
    channel: event.channel,
    actor: event.actor,
    principal: event.principal,
    visibility: event.visibility,
    payload: JSON.stringify(event.payload),
  });
  await foldMessagePosted(tx, dialect, keys, event);
}

function writer(tx: Db, dialect: Dialect, keys: BoardKeys, start: number): BoardWriter {
  let head = start;
  return {
    get head() {
      return head;
    },
    async append(events) {
      for (const event of events) {
        if (event.id !== head + 1) throw new Error(`event ${event.id} does not follow the board's head ${head}`);
        await appendEvent(tx, dialect, keys, event);
        head = event.id;
      }
      await setHead(tx, dialect, keys, head);
    },
  };
}

/** One board's view: every statement binds the scope's keys, and a view cannot name another tenant. */
export function boardView(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "write" | "channelMessages"> {
  const keys: BoardKeys = { orgId: scope.orgId, boardId: scope.boardId };
  return {
    write: (fn) =>
      db.transaction(async (tx) => {
        const head = await lockBoard(tx, dialect, keys);
        return fn(writer(tx, dialect, keys, head));
      }),
    async channelMessages({ channel, limit }) {
      const rows = await query(db, dialect, messageStatements.channelMessages, {
        boardId: keys.boardId,
        channel,
        limit,
      });
      return rows.map((row) => JSON.parse(String(row.view)) as Message).reverse();
    },
  };
}
