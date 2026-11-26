import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Event } from "../events.ts";
import { Labels, ScheduleSlot } from "../messages.ts";
import { Task } from "../tasks.ts";

const envelope = {
  version: Type.Literal(1),
  delivery: Type.Object({
    id: Type.String(),
    attempt: Type.Integer({ minimum: 1 }),
    webhook: Type.String(),
    name: Type.String(),
  }),
  board: Type.Object({ url: Type.String(), org: Type.String(), board: Type.String() }),
};

type MessageEventSchema = Extract<(typeof Event.anyOf)[number], { properties: { message: unknown } }>;

const WebhookEvent = Type.Union([
  Type.Object({ ...envelope, type: Type.Literal("board.ping") }),
  Type.Object({
    ...envelope,
    type: Type.Literal("board.event"),
    subject: Type.Object({
      channel: Type.String(),
      thread: Type.String(),
      message: Type.String(),
      task: Type.Union([
        Type.Object({ id: Type.String(), ...Type.Pick(Task, ["state", "owner", "for", "epoch"]).properties }),
        Type.Null(),
      ]),
      labels: Labels,
      schedule: Type.Union([ScheduleSlot, Type.Null()]),
      url: Type.String(),
    }),
    event: Type.Union(Event.anyOf.filter((schema): schema is MessageEventSchema => "message" in schema.properties)),
    truncated: Type.Optional(Type.Literal(true)),
  }),
]);

export type WebhookEvent = Static<typeof WebhookEvent>;

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return Value.Check(WebhookEvent, value);
}
