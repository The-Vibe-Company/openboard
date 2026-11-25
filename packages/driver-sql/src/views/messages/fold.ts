import type { BoardEvent, MessageDeleted } from "@openboard/core";
import type { BoardKeys } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { query } from "../../sql.ts";
import { foldActorSeen } from "../actors.ts";
import { foldAgentClaimed, foldAgentRefreshed } from "../agents.ts";
import { foldChannelCreated } from "../channels.ts";
import {
  foldAgentRevoked,
  foldConnectionCreated,
  foldConnectionRevoked,
  foldConnectionRotated,
} from "../connections.ts";
import { foldGrantEvent } from "../grants.ts";
import { foldInbound } from "../inbound/index.ts";
import { foldSchedule, isScheduleEvent } from "../schedules/index.ts";
import { foldSchemaRegistered } from "../schemas/registry.ts";
import { foldTaskEvent } from "../tasks/task-folds.ts";
import { foldWatchersRegistered } from "../watchers/index.ts";
import { foldWebhook } from "../webhooks/webhooks.ts";
import { foldMessagePosted } from "./post-fold.ts";
import { messageStatements } from "./statements.ts";

async function foldMessageDeleted(tx: Db, dialect: Dialect, keys: BoardKeys, event: MessageDeleted): Promise<void> {
  const { view } = event.payload;
  await query(tx, dialect, messageStatements.deleteMessage, {
    ...keys,
    id: event.message,
    labels: JSON.stringify(view.labels),
    revision: view.revision,
    version: view.version,
    view: JSON.stringify(view),
  });
  if (event.thread !== event.message) {
    await query(tx, dialect, messageStatements.dropRootReply, { ...keys, root: event.thread });
  }
}

/** Appends one event to the log and folds it, in the caller's transaction. */
export async function appendEvent(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  event: BoardEvent,
  fold = true,
): Promise<void> {
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
  if (fold) await foldEvent(tx, dialect, keys, event);
}

export async function foldEvent(tx: Db, dialect: Dialect, keys: BoardKeys, event: BoardEvent): Promise<void> {
  if (event.type === "channel.created") await foldChannelCreated(tx, dialect, keys, event);
  else if (
    event.type === "ob.grant.created" ||
    event.type === "ob.grant.revoked" ||
    event.type === "ob.grant.updated"
  ) {
    await foldGrantEvent(tx, dialect, keys, event);
  } else if (event.type === "ob.connection.created") await foldConnectionCreated(tx, dialect, keys, event);
  else if (event.type === "ob.connection.revoked") await foldConnectionRevoked(tx, dialect, keys, event);
  else if (event.type === "actor.seen") await foldActorSeen(tx, dialect, keys, event);
  else if (event.type === "ob.agent.claimed") await foldAgentClaimed(tx, dialect, keys, event);
  else if (event.type === "ob.agent.refreshed") await foldAgentRefreshed(tx, dialect, keys, event);
  else if (event.type === "ob.agent.revoked") await foldAgentRevoked(tx, dialect, keys, event);
  else if (event.type === "ob.connection.rotated") await foldConnectionRotated(tx, dialect, keys, event);
  else if (event.type === "message.edited") {
    const { text, view } = event.payload;
    await query(tx, dialect, messageStatements.editMessage, {
      ...keys,
      id: event.message,
      text,
      textLower: text.toLowerCase(),
      revision: view.revision,
      version: view.version,
      view: JSON.stringify(view),
    });
  } else if (event.type === "message.deleted") await foldMessageDeleted(tx, dialect, keys, event);
  else if (event.type === "reaction.added" || event.type === "reaction.removed") {
    const { view } = event.payload;
    await query(tx, dialect, messageStatements.reactToMessage, {
      ...keys,
      id: event.message,
      version: view.version,
      view: JSON.stringify(view),
    });
  } else if (event.type === "labels.changed") {
    const { view } = event.payload;
    await query(tx, dialect, messageStatements.labelMessage, {
      ...keys,
      id: event.message,
      labels: JSON.stringify(view.labels),
      version: view.version,
      view: JSON.stringify(view),
    });
  } else if (event.type === "message.posted") await foldMessagePosted(tx, dialect, keys, event);
  else if (isScheduleEvent(event)) await foldSchedule(tx, dialect, keys, event);
  else if (event.type === "ob.schema.registered") await foldSchemaRegistered(tx, dialect, keys, event);
  else if (event.type === "ob.watchers.registered") await foldWatchersRegistered(tx, dialect, keys, event);
  else if (
    event.type === "ob.webhook.created" ||
    event.type === "ob.webhook.deleted" ||
    event.type === "ob.webhook.updated" ||
    event.type === "ob.webhook.disabled"
  )
    await foldWebhook(tx, dialect, keys, event);
  else if (
    event.type === "ob.inbound.created" ||
    event.type === "ob.inbound.updated" ||
    event.type === "ob.inbound.deleted"
  )
    await foldInbound(tx, dialect, keys, event);
  else if (event.type !== "watch.failed") await foldTaskEvent(tx, dialect, keys, event);
}
