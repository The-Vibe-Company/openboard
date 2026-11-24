import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CanInput } from "../connections.ts";
import { Webhook, WebhookSpec } from "../webhooks/index.ts";

const Thread = Type.Object({ from: Type.String(), pattern: Type.String() }, { additionalProperties: false });
const Tolerance = Type.Optional(Type.Integer({ minimum: 0 }));
const fields = {
  name: Webhook.properties.name,
  can: CanInput,
  thread: Thread,
};
const action = <K extends string, T extends TSchema>(key: K, value: T) =>
  Type.Object({ [key]: value } as Record<K, T>, { additionalProperties: false });
const text = Type.String();
const empty = Type.Object({}, { additionalProperties: false });
const reason = Type.Object({ reason: Type.Optional(text) }, { additionalProperties: false });
const RuleAction = Type.Union([
  action("reply", text),
  action(
    "label",
    Type.Object(
      {
        set: Type.Optional(Type.Record(Type.String(), text)),
        unset: Type.Optional(Type.Array(text)),
        if: Type.Optional(Type.Record(Type.String(), Type.Union([text, Type.Null()]))),
      },
      { additionalProperties: false },
    ),
  ),
  action("react", text),
  action(
    "task.block",
    Type.Object(
      { kind: Type.Union([Type.Literal("agent"), Type.Literal("human")]), reason: text },
      { additionalProperties: false },
    ),
  ),
  action("task.unblock", empty),
  action("task.cancel", reason),
  action("task.expire", empty),
  action("agents.revoke", Type.Object({ connection: text, profile: text }, { additionalProperties: false })),
]);
const Match = Type.Union([text, Type.Number(), Type.Boolean(), Type.Null()]);
export const InboundRules = Type.Array(
  Type.Object(
    {
      when: Type.Record(Type.String({ pattern: "^body\\." }), Type.Union([Match, Type.Array(Match)]), {
        additionalProperties: false,
      }),
      do: Type.Array(RuleAction, { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
);
export type InboundRules = Static<typeof InboundRules>;
export function isInboundRules(input: unknown): input is InboundRules {
  return Value.Check(InboundRules, input);
}

export const InboundSpec = Type.Object(
  {
    ...fields,
    verify: Type.Object(
      { ...WebhookSpec.properties.signing.properties, tolerance: Tolerance },
      { additionalProperties: false },
    ),
    rules: InboundRules,
  },
  { additionalProperties: false },
);

export const Inbound = Type.Object({
  ...fields,
  id: Type.String(),
  url: Type.String(),
  principal: Type.String(),
  verify: Type.Object({ ...Webhook.properties.signing.properties, tolerance: Type.Integer() }),
  rules: InboundRules,
  enabled: Type.Boolean(),
  createdAt: Type.String(),
});
export type InboundSpec = Static<typeof InboundSpec>;
export type Inbound = Static<typeof Inbound>;
