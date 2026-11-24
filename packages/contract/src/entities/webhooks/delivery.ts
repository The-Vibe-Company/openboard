import { type Static, Type } from "@sinclair/typebox";

export const WebhookDeliveryState = Type.Union(
  [
    Type.Literal("pending"),
    Type.Literal("sending"),
    Type.Literal("done"),
    Type.Literal("dead"),
    Type.Literal("skipped"),
  ],
  { type: "string" },
);
export const WebhookDelivery = Type.Object({
  id: Type.String(),
  event: Type.Union([Type.Integer(), Type.Null()]),
  thread: Type.Union([Type.Integer(), Type.Null()]),
  state: WebhookDeliveryState,
  attempt: Type.Integer(),
  lastStatus: Type.Union([Type.Integer(), Type.Null()]),
  lastError: Type.Union([
    Type.Literal("timeout"),
    Type.Literal("unreachable"),
    Type.Literal("tls"),
    Type.Literal("status"),
    Type.Literal("too_large"),
    Type.Null(),
  ]),
  createdAt: Type.String({ format: "date-time" }),
  doneAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
});

export type WebhookDelivery = Static<typeof WebhookDelivery>;
