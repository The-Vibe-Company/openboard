import type { InboundConfig, QuotaOutcome } from "@openboard/core";
import type { WebhookSecret } from "../webhooks/index.ts";

export interface InboundRecord {
  readonly inbound: InboundConfig;
  readonly grantId: number;
}

export interface BoardInboundReads {
  inboundEndpoints(): Promise<InboundRecord[]>;
  inboundEndpoint(id: string): Promise<InboundRecord | null>;
  inboundSecret(id: string): Promise<WebhookSecret | null>;
}

export interface BoardInboundWriter extends BoardInboundReads {
  inboundQuota(): Promise<QuotaOutcome | null>;
  storeInboundSecret(id: string, secret: WebhookSecret): Promise<void>;
}
