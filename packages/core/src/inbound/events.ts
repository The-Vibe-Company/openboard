import type { Inbound, InboundRules } from "@openboard/contract";

import type { parseInboundRules, parseInboundThread } from "./rules.ts";

type RulePlan = ReturnType<typeof parseInboundRules>;
export type InboundConfig = Omit<Inbound, "url"> & {
  rulePlan?: RulePlan;
  threadPlan?: ReturnType<typeof parseInboundThread>;
};

type Audit = Omit<import("../webhooks/events.ts").WebhookCreated, "type" | "payload">;

export type InboundEvent = Audit &
  (
    | { readonly type: "ob.inbound.created"; readonly payload: { inbound: InboundConfig; grantId: number } }
    | {
        readonly type: "ob.inbound.updated";
        readonly payload: { id: string; rules: InboundRules; rulePlan?: RulePlan };
      }
    | { readonly type: "ob.inbound.deleted"; readonly payload: { id: string } }
  );
