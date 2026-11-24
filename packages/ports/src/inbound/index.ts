import type { InboundConfig, QuotaOutcome } from "@openboard/core";
import type { WebhookSecret } from "../webhooks/index.ts";

export interface InboundRecord {
  readonly inbound: InboundConfig;
  readonly grantId: number;
}

export interface InboundReceiptKey {
  readonly eventId: string;
  readonly at: number;
}

export interface InboundReceipt extends InboundReceiptKey {
  readonly result: string;
}

export interface BoardInboundReads {
  inboundReceived(
    endpoint: string,
    since: number,
    before: InboundReceiptKey | null,
    limit: number,
  ): Promise<InboundReceipt[]>;
  inboundEndpoints(): Promise<InboundRecord[]>;
  inboundEndpoint(id: string): Promise<InboundRecord | null>;
  inboundSecret(id: string): Promise<WebhookSecret | null>;
}

export interface BoardInboundWriter extends BoardInboundReads {
  inboundSeen(endpoint: string, eventId: string): Promise<string | null>;
  recordInboundSeen(endpoint: string, eventId: string, at: number, result: string): Promise<void>;
  inboundQuota(): Promise<QuotaOutcome | null>;
  storeInboundSecret(id: string, secret: WebhookSecret): Promise<void>;
}
