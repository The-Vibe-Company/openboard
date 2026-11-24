import type { Inbound, InboundRules } from "@openboard/contract";

export type InboundConfig = Omit<Inbound, "url">;

type Audit = Omit<import("../webhooks/events.ts").WebhookCreated, "type" | "payload">;

export type InboundEvent = Audit &
  (
    | { readonly type: "ob.inbound.created"; readonly payload: { inbound: InboundConfig; grantId: number } }
    | { readonly type: "ob.inbound.updated"; readonly payload: { id: string; rules: InboundRules } }
    | { readonly type: "ob.inbound.deleted"; readonly payload: { id: string } }
  );
