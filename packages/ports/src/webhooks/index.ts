import type { Message, Webhook, WebhookDelivery } from "@openboard/contract";
import type { QuotaOutcome, TailMessage } from "@openboard/core";

export interface WebhookRecord {
  readonly webhook: Webhook;
  readonly secretId: string;
  readonly ownerActor: string;
  readonly owner: string;
  readonly directory: boolean;
}

export interface WebhookSecret {
  readonly keyVersion: number;
  readonly ciphertext: string;
}

export interface WebhookAttempt {
  readonly webhook: Webhook;
  readonly record: WebhookRecord;
  readonly secret: WebhookSecret | null;
  readonly event: TailMessage | null;
  readonly root: Message | null;
  readonly attempt: number;
}

export interface BoardWebhookReads {
  webhooks(): Promise<WebhookRecord[]>;
  webhook(id: string): Promise<WebhookRecord | null>;
  webhookDeliveries(
    id: string,
    options: { state?: WebhookDelivery["state"]; before?: string; limit: number },
  ): Promise<WebhookDelivery[]>;
}

export interface BoardWebhookWriter extends BoardWebhookReads {
  waitingWebhookDeliveries(id: string): Promise<{ id: string; nextAt: number }[]>;
  webhookDeliveryChannels(id: string): Promise<(string | null)[]>;
  webhookSecret(record: WebhookRecord): Promise<WebhookSecret | null>;
  webhookQuota(): Promise<QuotaOutcome | null>;
  storeWebhookSecret(id: string, secretId: string, secret: WebhookSecret, now: number): Promise<void>;
  removeWebhookSecret(record: WebhookRecord): Promise<void>;
  beginWebhookPing(record: WebhookRecord, id: string, now: number): Promise<WebhookSecret | null>;
  retryWebhookDelivery(webhook: string, id: string, now: number): Promise<"queued" | "missing" | "not_dead">;
  beginWebhookAttempt(
    id: string,
    instance: string,
    now: number,
  ): Promise<WebhookAttempt | { expiredWebhookId: string } | null>;
  countRecentDeadWebhookDeliveries(webhook: string, cutoff: number): Promise<number>;
  finishWebhookAttempt(
    id: string,
    attempt: number,
    outcome: {
      status: number | null;
      error: string | null;
      now: number;
    } & (
      | { state: "done" | "dead"; nextAt?: never; revokedLease?: { jobId: string; instanceId: string } }
      | { state: "pending"; nextAt: number; revokedLease?: never }
    ),
  ): Promise<boolean>;
}

export const WEBHOOK_DELIVERY_JOB = "webhook-delivery";
export const WEBHOOK_RESEND_JOB = "webhook-resend";
