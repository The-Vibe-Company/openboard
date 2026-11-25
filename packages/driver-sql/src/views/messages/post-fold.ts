import { type MessagePosted, messages, parseId, parseScheduleId } from "@openboard/core";
import type { BoardKeys } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { query } from "../../sql.ts";
import { foldAttachments } from "../attachments/index.ts";
import { foldScheduleSend } from "../schedules/send.ts";
import { messageStatements } from "./statements.ts";

/**
 * The fold of `message.posted`: the message row with its precomputed view and its channel's row; a reply keeps its
 * root as `re` and the reply it answered as `reply_to`, and bumps its root's reply count, latest reply, activity and
 * version (docs/data-model.md "How folds are derived").
 */
export async function foldMessagePosted(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  event: MessagePosted,
): Promise<void> {
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
    scheduleId: payload.schedule ? parseScheduleId(payload.schedule.id) : null,
    scheduleN: payload.schedule?.n ?? null,
    text: payload.text,
    textLower: payload.text.toLowerCase(),
    labels: JSON.stringify(payload.labels),
    noSync: payload.noSync ? 1 : 0,
    at: event.at,
    view: JSON.stringify(messages.messageView(event)),
  });
  if (payload.schedule) await foldScheduleSend(tx, dialect, keys, event);
  if (payload.attachments.length) await foldAttachments(tx, dialect, keys, event.id, payload.attachments);
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
