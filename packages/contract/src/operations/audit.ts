import { type Static, type TObject, type TProperties, Type } from "@sinclair/typebox";
import { ClaimedAgent, Connection } from "../entities/connections.ts";
import { Author } from "../entities/messages.ts";
import { defineOperation } from "../operation.ts";

/** One audit entry: its log position as a cursor, when and by whom, and what changed; never a secret or its hash. */
function entry<Kind extends string, Payload extends TProperties>(type: Kind, payload: Payload) {
  return Type.Object({
    cursor: Type.String(),
    type: Type.Literal(type),
    createdAt: Type.String(),
    actor: Type.String(),
    principal: Type.String(),
    payload: Type.Object(payload) as TObject<Payload>,
  });
}

/** A board's `ob.*` event as the audit shows it (docs/auth.md "Audit"). */
export const AuditEvent = Type.Union([
  entry("ob.connection.created", {
    connection: Connection,
    /** How many claims the secret makes before it is spent, or null for no limit. */
    claims: Type.Union([Type.Integer(), Type.Null()]),
    by: Author,
  }),
  entry("ob.connection.revoked", { connection: Type.String(), grant: Type.String() }),
  entry("ob.connection.rotated", {
    connection: Type.String(),
    secretHint: Type.String(),
    /** When the replaced secret stops working, or null when it stopped at once. */
    previousUntil: Type.Union([Type.String(), Type.Null()]),
  }),
  entry("ob.agent.claimed", { agent: ClaimedAgent, connection: Type.String(), profile: Type.String(), by: Author }),
  entry("ob.agent.refreshed", {
    agent: Type.String(),
    expiresAt: Type.String(),
    /** When the token this refresh replaced stops working. */
    previousUntil: Type.String(),
    by: Author,
  }),
  entry("ob.agent.revoked", { connection: Type.String(), agent: Type.String() }),
]);
export type AuditEvent = Static<typeof AuditEvent>;

export const readBoardAudit = defineOperation({
  name: "readBoardAudit",
  summary: "Read the board's audit events (connections, agents) after a cursor, oldest first; never a secret.",
  route: { method: "GET", path: "/x/audit" },
  scope: "board",
  input: {
    query: Type.Object(
      {
        after: Type.Optional(Type.String({ description: "A cursor this route answered; absent, from the start." })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 100 })),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({
    events: Type.Array(AuditEvent),
    /** Where the next page starts: pass it back as `after`. */
    cursor: Type.String(),
  }),
  errors: ["invalid_cursor", "unauthorized", "forbidden"],
  access: { permission: "manage", channel: "any" },
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: { command: ["audit"], args: [] },
  mcp: false,
  why: "The audit is for the people who administer the board, like listing its connections.",
  upstream: false,
});
