import { type Static, Type } from "@sinclair/typebox";

export const WebhookFilter = Type.Object(
  {
    tail: Type.String({ maxLength: 4096 }),
    types: Type.Optional(Type.Array(Type.String())),
    became: Type.Optional(Type.Object({ task: Type.String() })),
  },
  { additionalProperties: false },
);
export type WebhookFilter = Static<typeof WebhookFilter>;

const presets = Type.Union([
  Type.Literal("standard-webhooks"),
  Type.Literal("github"),
  Type.Literal("stripe"),
  Type.Literal("ts-id-body"),
  Type.Literal("none"),
]);
const signingFields = {
  preset: Type.Optional(presets),
  algorithm: Type.Optional(
    Type.Union([Type.Literal("hmac-sha256"), Type.Literal("hmac-sha512"), Type.Literal("none")]),
  ),
  signatureHeader: Type.Optional(Type.String()),
  signatureFormat: Type.Optional(Type.String()),
  encoding: Type.Optional(Type.Union([Type.Literal("hex"), Type.Literal("base64"), Type.Literal("base64url")])),
  signedPayload: Type.Optional(Type.String()),
  timestampHeader: Type.Optional(Type.String()),
  timestampFormat: Type.Optional(Type.Union([Type.Literal("unix"), Type.Literal("unix_ms"), Type.Literal("iso8601")])),
  idHeader: Type.Optional(Type.String()),
};
const config = {
  name: Type.String({ minLength: 1, maxLength: 100, pattern: "^[^\\u0000]+$" }),
  url: Type.String({ maxLength: 4096 }),
  filter: WebhookFilter,
};
const headers = Type.Record(Type.String(), Type.String());
export const WebhookSpec = Type.Object(
  {
    ...config,
    signing: Type.Optional(
      Type.Object(
        {
          ...signingFields,
          secret: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
        },
        { additionalProperties: false },
      ),
    ),
    headers: Type.Optional(headers),
    body: Type.Optional(Type.Unknown()),
    enabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type WebhookSpec = Static<typeof WebhookSpec>;

export const Webhook = Type.Object({
  ...config,
  id: Type.String(),
  signing: Type.Object(signingFields),
  headers,
  body: Type.Unknown(),
  enabled: Type.Boolean(),
  disabledReason: Type.Union([Type.Null(), Type.String()]),
  createdAt: Type.String(),
});
export type Webhook = Static<typeof Webhook>;
