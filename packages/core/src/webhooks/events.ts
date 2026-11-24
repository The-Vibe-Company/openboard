import type { Webhook } from "@openboard/contract";

interface Audit {
  readonly id: number;
  readonly at: number;
  readonly actor: string;
  readonly principal: string;
  readonly channel: null;
  readonly thread: null;
  readonly message: null;
  readonly visibility: 2;
}

export interface WebhookCreated extends Audit {
  readonly type: "ob.webhook.created";
  readonly payload: { readonly webhook: Webhook; readonly directory: boolean; readonly secretId: string };
}

interface WebhookChange extends Audit {
  readonly payload: { readonly webhook: Webhook; readonly secretId: string };
}

export type WebhookUpdated =
  | (WebhookChange & { readonly type: "ob.webhook.updated" })
  | (WebhookChange & {
      readonly type: "ob.webhook.disabled";
      readonly payload: { readonly webhook: Webhook & { readonly disabledReason: "gone" | "dead_deliveries" } };
    });

export interface WebhookDeleted extends Audit {
  readonly type: "ob.webhook.deleted";
  readonly payload: { readonly id: string; readonly secretId: string };
}
