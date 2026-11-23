import type { Actor, Message } from "@openboard/contract";
import { type BoardEvent, type MessagePosted, messages, parseId } from "@openboard/core";
import type { BoardKeys, BoardScope, BoardView, BoardWriter } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { query, sql } from "../sql.ts";
import { foldActorSeen, lockBoardAs } from "./actors.ts";
import { foldAgentClaimed } from "./agents.ts";
import { lockBoard, setHead } from "./boards.ts";
import { findChannel, foldChannelCreated } from "./channels.ts";
import { connectionNamed, foldConnectionCreated, nextGrant } from "./connections.ts";

export const messageStatements = {
  insertEvent: sql`INSERT INTO events (org_id, board_id, id, type, at, thread, message, channel, actor, principal,
    visibility, payload) VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"type"}, ${"at"}, ${"thread"}, ${"message"},
    ${"channel"}, ${"actor"}, ${"principal"}, ${"visibility"}, ${"payload"})`,
  insertMessage: sql`INSERT INTO messages (org_id, board_id, id, channel, re, reply_to, actor, principal, profile,
    client_id, text, text_lower, labels, no_sync, version, created_at, active, view) VALUES (${"orgId"}, ${"boardId"},
    ${"id"}, ${"channel"}, ${"re"}, ${"replyTo"}, ${"actor"}, ${"principal"}, ${"profile"}, ${"clientId"}, ${"text"},
    ${"textLower"},
    ${"labels"}, ${"noSync"}, ${"id"}, ${"at"}, ${"active"}, ${"view"})`,
  bumpRoot: sql`UPDATE messages SET replies = replies + 1, last_reply = ${"id"}, active = ${"id"}, version = ${"id"}
    WHERE board_id = ${"boardId"} AND id = ${"root"}`,
  upsertChannel: sql`INSERT INTO channels (org_id, board_id, path, created_at, last_index, messages, threads)
    VALUES (${"orgId"}, ${"boardId"}, ${"path"}, ${"at"}, ${"id"}, 1, ${"threads"}) ON CONFLICT (board_id, path)
    DO UPDATE SET last_index = excluded.last_index, messages = channels.messages + 1,
    threads = channels.threads + excluded.threads`,
  replyTarget: sql`SELECT id, channel, COALESCE(re, id) AS thread FROM messages
    WHERE board_id = ${"boardId"} AND id = ${"id"}`,
  newerReply: sql`SELECT id FROM messages WHERE board_id = ${"boardId"} AND re = ${"thread"} AND id > ${"after"}
    ORDER BY id LIMIT 1`,
  clientPost: sql`SELECT view FROM messages WHERE board_id = ${"boardId"} AND client_id = ${"clientId"}`,
  ownClientPost: sql`SELECT view FROM messages WHERE board_id = ${"boardId"} AND org_id = ${"orgId"}
    AND client_id = ${"clientId"} AND principal = ${"principal"} AND actor = ${"actor"}`,
  channelMessages: sql`SELECT view FROM messages WHERE board_id = ${"boardId"} AND channel = ${"channel"}
    ORDER BY id DESC LIMIT ${"limit"}`,
  // Bound the page with the channel index before joining it to the board head from the same snapshot.
  channelMessagesAfter: sql`WITH page AS (
    SELECT id, view FROM messages WHERE board_id = ${"boardId"} AND org_id = ${"orgId"} AND channel = ${"channel"}
      AND id > ${"after"} ORDER BY id LIMIT ${"limit"}
  )
    SELECT b.head, p.view FROM boards b LEFT JOIN page p ON p.id <= b.head
    WHERE b.id = ${"boardId"} AND b.org_id = ${"orgId"} ORDER BY p.id`,
};

/**
 * The fold of `message.posted`: the message row with its precomputed view and its channel's row; a reply keeps its
 * root as `re` and the reply it answered as `reply_to`, and bumps its root's reply count, latest reply, activity and
 * version (docs/data-model.md "How folds are derived").
 */
async function foldMessagePosted(tx: Db, dialect: Dialect, keys: BoardKeys, event: MessagePosted): Promise<void> {
  const { payload } = event;
  const reply = payload.re !== null;
  await query(tx, dialect, messageStatements.insertMessage, {
    ...keys,
    id: event.id,
    channel: payload.channel,
    re: reply ? event.thread : null,
    replyTo: payload.replyTo === null ? null : parseId(payload.replyTo),
    active: reply ? null : event.id,
    actor: payload.by.actor,
    principal: payload.by.principal,
    profile: payload.by.profile,
    clientId: payload.clientId ?? null,
    text: payload.text,
    textLower: payload.text.toLowerCase(),
    labels: JSON.stringify(payload.labels),
    noSync: payload.noSync ? 1 : 0,
    at: event.at,
    view: JSON.stringify(messages.messageView(event)),
  });
  if (reply)
    await query(tx, dialect, messageStatements.bumpRoot, { boardId: keys.boardId, id: event.id, root: event.thread });
  await query(tx, dialect, messageStatements.upsertChannel, {
    ...keys,
    path: payload.channel,
    at: event.at,
    id: event.id,
    threads: reply ? 0 : 1,
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
  if (event.type === "channel.created") await foldChannelCreated(tx, dialect, keys, event);
  else if (event.type === "ob.connection.created") await foldConnectionCreated(tx, dialect, keys, event);
  else if (event.type === "actor.seen") await foldActorSeen(tx, dialect, keys, event);
  else if (event.type === "ob.agent.claimed") await foldAgentClaimed(tx, dialect, keys, event);
  else await foldMessagePosted(tx, dialect, keys, event);
}

function writer(tx: Db, dialect: Dialect, keys: BoardKeys, start: number, actor: Actor | null): BoardWriter {
  let head = start;
  return {
    get head() {
      return head;
    },
    channel: (path) => findChannel(tx, dialect, keys, path),
    actor,
    async replyTarget(id) {
      const [row] = await query(tx, dialect, messageStatements.replyTarget, { boardId: keys.boardId, id });
      if (!row) return null;
      return { id: Number(row.id), channel: String(row.channel), thread: Number(row.thread) };
    },
    async newerReply(thread, after) {
      const [row] = await query(tx, dialect, messageStatements.newerReply, { boardId: keys.boardId, thread, after });
      return row ? Number(row.id) : null;
    },
    async clientPost(clientId) {
      const [row] = await query(tx, dialect, messageStatements.clientPost, { boardId: keys.boardId, clientId });
      return row ? (JSON.parse(String(row.view)) as Message) : null;
    },
    nextGrant: () => nextGrant(tx, dialect, keys),
    connectionNamed: (name) => connectionNamed(tx, dialect, keys, name),
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
export function boardView(
  db: Db,
  dialect: Dialect,
  scope: BoardScope,
): Pick<BoardView, "write" | "channelMessages" | "ownClientPost"> {
  const keys: BoardKeys = { orgId: scope.orgId, boardId: scope.boardId };
  return {
    write: (fn, as) =>
      db.transaction(async (tx) => {
        if (as === undefined) return fn(writer(tx, dialect, keys, await lockBoard(tx, dialect, keys), null));
        const { head, actor } = await lockBoardAs(tx, dialect, keys, as);
        return fn(writer(tx, dialect, keys, head, actor));
      }),
    async ownClientPost(clientId, { actor, principal }) {
      if (clientId.includes("\0")) return null;
      const [row] = await query(db, dialect, messageStatements.ownClientPost, { ...keys, clientId, actor, principal });
      return row ? (JSON.parse(String(row.view)) as Message) : null;
    },
    async channelMessages({ channel, after, limit }) {
      const params = { boardId: keys.boardId, channel, limit };
      if (after !== undefined) {
        const rows = await query(db, dialect, messageStatements.channelMessagesAfter, {
          ...params,
          orgId: keys.orgId,
          after,
        });
        const first = rows[0];
        if (!first) throw new Error("the scoped board is missing");
        if (after > Number(first.head)) return null;
        return rows.filter((row) => row.view !== null).map((row) => JSON.parse(String(row.view)) as Message);
      }
      const rows = await query(db, dialect, messageStatements.channelMessages, params);
      return rows.map((row) => JSON.parse(String(row.view)) as Message).reverse();
    },
  };
}
