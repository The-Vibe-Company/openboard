import type { Webhook, WebhookDelivery } from "@openboard/contract";
import { isoTime, type WebhookCreated, type WebhookDeleted, type WebhookUpdated } from "@openboard/core";
import {
  type BoardKeys,
  type BoardWebhookReads,
  type BoardWebhookWriter,
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_RESEND_JOB,
  type WebhookRecord,
} from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { query, sql } from "../../sql.ts";
import { exhaustedQuota } from "../orgs.ts";

export const webhookStatements = {
  webhooks: sql`SELECT config, secret_id, owner_actor, owner, directory, workload FROM webhooks
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} ORDER BY id`,
  webhook: sql`SELECT config, secret_id, owner_actor, owner, directory, workload FROM webhooks
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
  insertWebhook: sql`INSERT INTO webhooks (org_id, board_id, id, name, owner_actor, owner, secret_id, enabled, directory, config, workload)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"name"}, ${"ownerActor"}, ${"owner"}, ${"secretId"}, ${"enabled"}, ${"directory"}, ${"config"}, ${"workload"})`,
  updateWebhook: sql`UPDATE webhooks SET name = ${"name"}, secret_id = ${"secretId"}, enabled = ${"enabled"}, config = ${"config"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  waitingWebhookDeliveries: sql`SELECT d.id, d.next_at FROM webhook_deliveries d
    WHERE d.org_id = ${"orgId"} AND d.board_id = ${"boardId"} AND d.webhook = ${"id"}
      AND (d.state = 'pending' OR (d.state = 'sending' AND d.instance IS NOT NULL)) AND NOT EXISTS (
        SELECT 1 FROM jobs j WHERE j.org_id = ${"orgId"} AND j.board_id = ${"boardId"}
          AND j.kind IN (${"deliveryJob"}, ${"resendJob"}) AND j.payload = ('{"id":"' || d.id || '"}')
      )
    ORDER BY d.next_at, d.created_at, d.id`,
  webhookDeliveryChannels: sql`SELECT DISTINCT e.channel FROM webhook_deliveries d
    LEFT JOIN events e ON e.org_id = d.org_id AND e.board_id = d.board_id AND e.id = d.event
    WHERE d.org_id = ${"orgId"} AND d.board_id = ${"boardId"} AND d.webhook = ${"id"} AND d.event IS NOT NULL`,
  deferSendingWebhookDeliveries: sql`UPDATE webhook_deliveries SET next_at = COALESCE((
      SELECT MAX(j.available_at) FROM jobs j WHERE j.org_id = ${"orgId"} AND j.board_id = ${"boardId"}
        AND j.kind IN (${"deliveryJob"}, ${"resendJob"})
        AND j.instance_id = webhook_deliveries.instance AND j.available_at > webhook_deliveries.next_at
        AND j.payload = ('{"id":"' || webhook_deliveries.id || '"}')
    ), next_at)
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND webhook = ${"id"} AND state = 'sending'
      AND instance IS NOT NULL`,
  parkWebhookJobs: sql`DELETE FROM jobs WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}
    AND kind IN (${"deliveryJob"}, ${"resendJob"}) AND payload IN (
      SELECT '{"id":"' || d.id || '"}' FROM webhook_deliveries d
      WHERE d.org_id = ${"orgId"} AND d.board_id = ${"boardId"} AND d.webhook = ${"id"}
    )`,
  webhookSecret: sql`SELECT ciphertext, key_version FROM webhook_secrets
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND webhook_id = ${"id"} AND id = ${"secretId"}`,
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
    ...(typeof row.workload === "string" && {
      workload: JSON.parse(row.workload) as NonNullable<WebhookRecord["workload"]>,
    }),
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
): Omit<
  BoardWebhookWriter,
  | "beginWebhookPing"
  | "retryWebhookDelivery"
  | "beginWebhookAttempt"
  | "finishWebhookAttempt"
  | "countRecentDeadWebhookDeliveries"
> {
  return {
    ...webhookReads(db, dialect, keys),
    async waitingWebhookDeliveries(id) {
      const rows = await query(db, dialect, webhookStatements.waitingWebhookDeliveries, {
        ...keys,
        id,
        deliveryJob: WEBHOOK_DELIVERY_JOB,
        resendJob: WEBHOOK_RESEND_JOB,
      });
      return rows.map((row) => ({ id: String(row.id), nextAt: Number(row.next_at) }));
    },
    async webhookDeliveryChannels(id) {
      const rows = await query(db, dialect, webhookStatements.webhookDeliveryChannels, { ...keys, id });
      return rows.map(({ channel }) => (typeof channel === "string" ? channel : null));
    },
    async webhookSecret({ webhook, secretId }) {
      const [row] = await query(db, dialect, webhookStatements.webhookSecret, { ...keys, id: webhook.id, secretId });
      return typeof row?.ciphertext === "string"
        ? { ciphertext: row.ciphertext, keyVersion: Number(row.key_version) }
        : null;
    },
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

export async function foldWebhook(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
  event: WebhookCreated | WebhookDeleted | WebhookUpdated,
  reproject: boolean,
) {
  if (event.type === "ob.webhook.deleted") {
    await query(db, dialect, webhookStatements.deleteWebhook, { ...keys, id: event.payload.id });
    return;
  }
  const { webhook, secretId } = event.payload;
  const config = {
    ...keys,
    id: webhook.id,
    name: webhook.name,
    secretId,
    enabled: Number(webhook.enabled),
    config: JSON.stringify(webhook),
  };
  if (event.type !== "ob.webhook.created") {
    await query(db, dialect, webhookStatements.updateWebhook, config);
    if (!webhook.enabled && !reproject) {
      const jobs = { ...keys, id: webhook.id, deliveryJob: WEBHOOK_DELIVERY_JOB, resendJob: WEBHOOK_RESEND_JOB };
      // A resumed send must wait for the original attempt's lease to end.
      await query(db, dialect, webhookStatements.deferSendingWebhookDeliveries, jobs);
      // Revoke queued and leased dispatch jobs so older workers cannot skip paused deliveries.
      await query(db, dialect, webhookStatements.parkWebhookJobs, jobs);
    }
    return;
  }
  await query(db, dialect, webhookStatements.insertWebhook, {
    ...config,
    ownerActor: event.actor,
    owner: event.principal,
    directory: Number(event.payload.directory),
    workload: event.payload.workload ? JSON.stringify(event.payload.workload) : null,
  });
}
