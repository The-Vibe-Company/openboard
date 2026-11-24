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
  readonly event: TailMessage;
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
  webhookQuota(): Promise<QuotaOutcome | null>;
  storeWebhookSecret(id: string, secretId: string, secret: WebhookSecret, now: number): Promise<void>;
  removeWebhookSecret(record: WebhookRecord): Promise<void>;
  beginWebhookPing(record: WebhookRecord, id: string, now: number): Promise<WebhookSecret | null>;
  beginWebhookAttempt(id: string, instance: string, now: number): Promise<WebhookAttempt | null>;
  finishWebhookAttempt(
    id: string,
    attempt: number,
    outcome: {
      status: number | null;
      error: string | null;
      now: number;
    } & ({ state: "done" | "dead"; nextAt?: never } | { state: "pending"; nextAt: number }),
  ): Promise<void>;
}

export const WEBHOOK_DELIVERY_JOB = "webhook-delivery";
