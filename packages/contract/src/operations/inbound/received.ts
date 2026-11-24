import { Type } from "@sinclair/typebox";
import { defineOperation, Ref } from "../../operation.ts";

const result = Type.Union([
  Type.Object({ reply: Type.String() }),
  Type.Object({ label: Type.String() }),
  Type.Object({ react: Type.String() }),
]);

export const listInboundReceived = defineOperation({
  name: "listInboundReceived",
  summary: "List an inbound endpoint's received events from the last seven days, newest first.",
  route: { method: "GET", path: "/x/inbound/:id/received" },
  scope: "board",
  upstream: false,
  input: {
    params: Type.Object({ id: Ref("inbound") }),
    query: Type.Object(
      {
        before: Type.Optional(
          Type.String({
            pattern: "^-?[0-9]{1,16}\\.[A-Za-z0-9_-]{1,1366}$",
            description: "The previous page's older cursor.",
          }),
        ),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: "Page size, 50 by default." })),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({
    events: Type.Array(
      Type.Object({
        eventId: Type.String(),
        at: Type.String({ format: "date-time" }),
        status: Type.Union([Type.Literal(200), Type.Literal(422)]),
        matched: Type.Array(Type.Integer()),
        results: Type.Array(result),
      }),
    ),
    older: Type.Union([Type.String(), Type.Null()]),
  }),
  errors: ["not_found", "forbidden", "invalid_request"],
  access: { permission: "manage", channel: "any" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["inbound", "received"], args: ["id"] },
  mcp: false,
  why: "Inbound receipt history is a board administration command.",
});
