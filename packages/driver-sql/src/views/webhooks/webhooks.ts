import type { Webhook, WebhookDelivery } from "@openboard/contract";
import { isoTime, type WebhookCreated, type WebhookDeleted } from "@openboard/core";
import type { BoardKeys, BoardWebhookReads, BoardWebhookWriter, WebhookRecord } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { query, sql } from "../../sql.ts";
import { exhaustedQuota } from "../orgs.ts";

export const webhookStatements = {
  webhooks: sql`SELECT config, secret_id, owner_actor, owner, directory FROM webhooks
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} ORDER BY id`,
  webhook: sql`SELECT config, secret_id, owner_actor, owner, directory FROM webhooks
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  deliveryCursor: sql`SELECT created_at FROM webhook_deliveries
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND webhook = ${"id"} AND id = ${"before"}`,
  webhookDeliveries: sql`SELECT id, event, thread, state, attempt, last_status, last_error, created_at, done_at
    FROM webhook_deliveries
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND webhook = ${"id"}
      AND (created_at, id) < (${"beforeAt"}, ${"beforeId"})
    ORDER BY created_at DESC, id DESC LIMIT ${"limit"}`,
  webhookDeliveriesByState: sql`SELECT id, event, thread, state, attempt, last_status, last_error, created_at, done_at
    FROM webhook_deliveries
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND webhook = ${"id"} AND state = ${"state"}
      AND (created_at, id) < (${"beforeAt"}, ${"beforeId"})
    ORDER BY created_at DESC, id DESC LIMIT ${"limit"}`,
  webhookQuota: sql`SELECT o.quotas, (SELECT COUNT(*) FROM webhooks
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}) AS count
    FROM boards b JOIN orgs o ON o.id = b.org_id WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"}`,
  insertWebhook: sql`INSERT INTO webhooks (org_id, board_id, id, name, owner_actor, owner, secret_id, enabled, directory, config)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"name"}, ${"ownerActor"}, ${"owner"}, ${"secretId"}, ${"enabled"}, ${"directory"}, ${"config"})`,
  deleteWebhook: sql`DELETE FROM webhooks WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  storeWebhookSecret: sql`INSERT INTO webhook_secrets (org_id, board_id, id, webhook_id, key_version, ciphertext, created_at)
    VALUES (${"orgId"}, ${"boardId"}, ${"secretId"}, ${"id"}, ${"keyVersion"}, ${"ciphertext"}, ${"now"})`,
  removeWebhookSecret: sql`DELETE FROM webhook_secrets
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND webhook_id = ${"id"} AND id = ${"secretId"}`,
};

export function webhookRecord(row: Row): WebhookRecord {
  return {
    webhook: JSON.parse(String(row.config)) as Webhook,
    secretId: String(row.secret_id),
    ownerActor: String(row.owner_actor),
    owner: String(row.owner),
    directory: Boolean(row.directory),
  };
}

function deliveryError(error: unknown, status: number | null): WebhookDelivery["lastError"] {
  if (error === "timeout" || error === "tls" || error === "too_large") return error;
  if (status !== null && (status < 200 || status >= 300)) return "status";
  return error == null ? null : "unreachable";
}

function delivery(row: Row): WebhookDelivery {
  const lastStatus = row.last_status === null ? null : Number(row.last_status);
  return {
    id: String(row.id),
    event: row.event === null ? null : Number(row.event),
    thread: row.thread === null ? null : Number(row.thread),
    state: row.state as WebhookDelivery["state"],
    attempt: Number(row.attempt),
    lastStatus,
    lastError: deliveryError(row.last_error, lastStatus),
    createdAt: isoTime(Number(row.created_at)),
    doneAt: row.done_at === null ? null : isoTime(Number(row.done_at)),
  };
}

export function webhookReads(db: Db, dialect: Dialect, keys: BoardKeys): BoardWebhookReads {
  return {
    async webhooks() {
      return (await query(db, dialect, webhookStatements.webhooks, keys)).map(webhookRecord);
    },
    async webhookDeliveries(id, { state, before, limit }) {
      const scope = { ...keys, id };
      const anchor =
        before === undefined
          ? undefined
          : (await query(db, dialect, webhookStatements.deliveryCursor, { ...scope, before }))[0];
      if (before !== undefined && !anchor) return [];
      const page = {
        ...scope,
        beforeAt: anchor ? Number(anchor.created_at) : Number.MAX_SAFE_INTEGER,
        beforeId: before ?? "",
        limit,
      };
      const rows =
        state === undefined
          ? await query(db, dialect, webhookStatements.webhookDeliveries, page)
          : await query(db, dialect, webhookStatements.webhookDeliveriesByState, { ...page, state });
      return rows.map(delivery);
    },
    async webhook(id) {
      const [row] = await query(db, dialect, webhookStatements.webhook, { ...keys, id });
      return row ? webhookRecord(row) : null;
    },
  };
}

export function webhookWriter(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
): Omit<BoardWebhookWriter, "beginWebhookPing" | "beginWebhookAttempt" | "finishWebhookAttempt"> {
  return {
    ...webhookReads(db, dialect, keys),
    async webhookQuota() {
      const [row] = await query(db, dialect, webhookStatements.webhookQuota, keys);
      return exhaustedQuota("webhooks", row?.quotas, row?.count);
    },
    async storeWebhookSecret(id, secretId, secret, now) {
      await query(db, dialect, webhookStatements.storeWebhookSecret, {
        ...keys,
        id,
        secretId,
        ...secret,
        now,
      });
    },
    async removeWebhookSecret({ webhook, secretId }) {
      await query(db, dialect, webhookStatements.removeWebhookSecret, { ...keys, id: webhook.id, secretId });
    },
  };
}

export async function foldWebhook(db: Db, dialect: Dialect, keys: BoardKeys, event: WebhookCreated | WebhookDeleted) {
  if (event.type === "ob.webhook.deleted") {
    await query(db, dialect, webhookStatements.deleteWebhook, { ...keys, id: event.payload.id });
    return;
  }
  const { webhook, secretId, directory } = event.payload;
  await query(db, dialect, webhookStatements.insertWebhook, {
    ...keys,
    id: webhook.id,
    name: webhook.name,
    ownerActor: event.actor,
    owner: event.principal,
    secretId,
    enabled: webhook.enabled ? 1 : 0,
    directory: directory ? 1 : 0,
    config: JSON.stringify(webhook),
  });
}
