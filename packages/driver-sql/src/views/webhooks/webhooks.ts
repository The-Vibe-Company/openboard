import type { Webhook } from "@openboard/contract";
import type { WebhookCreated, WebhookDeleted } from "@openboard/core";
import type { BoardKeys, BoardWebhookReads, BoardWebhookWriter, WebhookRecord } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { query, sql } from "../../sql.ts";
import { exhaustedQuota } from "../orgs.ts";

export const webhookStatements = {
  webhooks: sql`SELECT config, secret_id, owner_actor, owner, directory FROM webhooks
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} ORDER BY id`,
  webhook: sql`SELECT config, secret_id, owner_actor, owner, directory FROM webhooks
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
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

export function webhookReads(db: Db, dialect: Dialect, keys: BoardKeys): BoardWebhookReads {
  return {
    async webhooks() {
      return (await query(db, dialect, webhookStatements.webhooks, keys)).map(webhookRecord);
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
): Omit<BoardWebhookWriter, "beginWebhookAttempt" | "finishWebhookAttempt"> {
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
