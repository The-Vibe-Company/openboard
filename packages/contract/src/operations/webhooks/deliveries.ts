import { Type } from "@sinclair/typebox";
import { WebhookDelivery, WebhookDeliveryState } from "../../entities/webhooks/delivery.ts";
import { defineOperation, Ref } from "../../operation.ts";

export const listWebhookDeliveries = defineOperation({
  name: "listWebhookDeliveries",
  summary:
    "List a webhook's deliveries newest first. Done and skipped deliveries are kept for 7 days, and dead deliveries for 30 days.",
  route: { method: "GET", path: "/x/webhooks/:id/deliveries" },
  scope: "board",
  input: {
    params: Type.Object({ id: Ref("webhook") }),
    query: Type.Object(
      {
        state: Type.Optional(WebhookDeliveryState),
        before: Type.Optional(
          Type.String({ pattern: "^dl_[a-z2-7]{16}$", description: "The previous page's older cursor." }),
        ),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: "Page size, 50 by default." })),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({
    deliveries: Type.Array(WebhookDelivery),
    older: Type.Union([Type.String(), Type.Null()]),
  }),
  errors: ["not_found", "forbidden", "invalid_request"],
  access: { permission: "manage", channel: "some" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["webhooks", "deliveries"], args: ["id"] },
  mcp: false,
  why: "Webhook delivery history is a board administration command.",
  upstream: false,
});

export const retryWebhookDelivery = defineOperation({
  name: "retryWebhookDelivery",
  summary: "Queue a dead webhook delivery again.",
  route: { method: "POST", path: "/x/webhooks/:id/deliveries/:dl/retry" },
  scope: "board",
  input: { params: Type.Object({ id: Ref("webhook"), dl: Ref("delivery") }) },
  output: Type.Object({ id: Type.String() }),
  errors: ["not_found", "forbidden", "invalid_request"],
  access: { permission: "manage", channel: "some" },
  effects: { readOnly: false, idempotent: false, emits: [] },
  cli: { command: ["webhooks", "retry"], args: ["id", "dl"] },
  mcp: false,
  why: "Retrying a delivery is a board administration command.",
  upstream: false,
});
