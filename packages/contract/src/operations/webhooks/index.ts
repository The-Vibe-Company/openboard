import { Type } from "@sinclair/typebox";
import { Webhook, WebhookSpec } from "../../entities/webhooks/index.ts";
import { defineOperation, Ref } from "../../operation.ts";

const common = {
  scope: "board",
  upstream: false,
  access: { permission: "manage", channel: "some" },
  mcp: false,
  why: "Webhook configuration is a board administration command.",
} as const;
const params = Type.Object({ id: Ref("webhook") });

export const createWebhook = defineOperation({
  ...common,
  name: "createWebhook",
  summary: "Subscribe to board events and return the signing secret once.",
  route: { method: "POST", path: "/x/webhooks" },
  input: { body: WebhookSpec },
  output: Type.Object({ webhook: Webhook, secret: Type.String() }),
  status: 201,
  errors: [
    "forbidden",
    "invalid_request",
    "invalid_url",
    "invalid_signing",
    "bad_watcher",
    "quota_exceeded",
    "not_supported",
    "slug_taken",
  ],
  effects: { readOnly: false, idempotent: false, emits: ["ob.webhook.created"] },
  cli: false,
  why: "The CLI writes the signing secret to a private file.",
});

export const deleteWebhook = defineOperation({
  ...common,
  name: "deleteWebhook",
  summary: "Delete a webhook and stop its queued deliveries.",
  route: { method: "POST", path: "/x/webhooks/:id/delete" },
  input: { params },
  output: Type.Object({ id: Type.String() }),
  errors: ["not_found", "forbidden"],
  effects: { readOnly: false, idempotent: false, emits: ["ob.webhook.deleted"] },
  cli: { command: ["webhooks", "delete"], args: ["id"] },
});

export const getWebhook = defineOperation({
  ...common,
  name: "getWebhook",
  summary: "Show a webhook without receiver credentials.",
  route: { method: "GET", path: "/x/webhooks/:id" },
  input: { params },
  output: Webhook,
  errors: ["not_found", "forbidden"],
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["webhooks", "show"], args: ["id"] },
});

export const listWebhooks = defineOperation({
  ...common,
  name: "listWebhooks",
  summary: "List manageable webhooks without receiver credentials.",
  route: { method: "GET", path: "/x/webhooks" },
  input: {},
  output: Type.Object({ webhooks: Type.Array(Webhook) }),
  errors: ["forbidden"],
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["webhooks"], args: [] },
});

export const testWebhook = defineOperation({
  ...common,
  name: "testWebhook",
  summary: "Send a signed, single-attempt ping to a webhook receiver.",
  route: { method: "POST", path: "/x/webhooks/:id/test" },
  input: { params },
  output: Type.Object({
    delivery: Type.Object({
      id: Type.String(),
      status: Type.Union([Type.Integer(), Type.Null()]),
      ok: Type.Boolean(),
      ms: Type.Integer({ minimum: 0 }),
      error: Type.Optional(Type.Literal("unreachable")),
    }),
  }),
  errors: ["not_found", "forbidden"],
  effects: { readOnly: false, idempotent: false, emits: [] },
  cli: { command: ["webhooks", "test"], args: ["id"] },
});
