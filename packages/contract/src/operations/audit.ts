import { type Static, type TObject, type TProperties, Type } from "@sinclair/typebox";
import { ClaimedAgent, Connection } from "../entities/connections.ts";
import { GrantView } from "../entities/grants.ts";
import { InvitationRole } from "../entities/invitations.ts";
import { Author } from "../entities/messages.ts";
import { DeletedBoard, DeletedOrg, Named, Role, Slug } from "../entities/orgs.ts";
import { WebhookDisabledReason } from "../entities/webhooks/index.ts";
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
  entry("ob.inbound.created", { id: Type.String(), name: Type.String() }),
  entry("ob.inbound.updated", { id: Type.String() }),
  entry("ob.inbound.deleted", { id: Type.String() }),
  entry("ob.webhook.disabled", {
    id: Type.String(),
    reason: WebhookDisabledReason,
  }),
  entry("ob.webhook.updated", { id: Type.String(), name: Type.String(), enabled: Type.Boolean() }),
  entry("ob.webhook.created", { id: Type.String(), name: Type.String() }),
  entry("ob.webhook.deleted", { id: Type.String() }),
  entry("ob.schedule.created", { id: Type.String() }),
  entry("ob.schedule.canceled", { id: Type.String() }),
  entry("ob.schema.registered", { id: Type.String() }),
  entry("ob.watchers.registered", { owner: Type.String() }),
  entry("ob.grant.created", { grant: GrantView }),
  entry("ob.grant.updated", { grant: GrantView }),
  entry("ob.grant.revoked", { grant: Type.String() }),
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

/** One organization audit entry: its organization cursor, when and by whom, and what changed. */
function orgEntry<Kind extends string, Payload extends TProperties>(type: Kind, payload: Payload) {
  return Type.Object({
    cursor: Type.String(),
    type: Type.Literal(type),
    createdAt: Type.String(),
    actor: Type.String(),
    payload: Type.Object(payload) as TObject<Payload>,
  });
}

/** An organization event (`org_events`) as the audit shows it (docs/auth.md "Audit"). */
export const OrgAuditEvent = Type.Union([
  orgEntry("ob.operator.quota_changed", {
    quota: Type.Union([Type.Literal("boards"), Type.Literal("members"), Type.Literal("connections")]),
    previousLimit: Type.Integer({ minimum: 0 }),
    limit: Type.Integer({ minimum: 0 }),
    reason: Type.String({ minLength: 1 }),
  }),
  orgEntry("ob.operator.deleted", { reason: Type.String({ minLength: 1 }) }),
  orgEntry("ob.operator.undeleted", { reason: Type.String({ minLength: 1 }) }),
  orgEntry("ob.org.created", { org: Named, owner: Type.String() }),
  orgEntry("ob.org.deleted", DeletedOrg.properties),
  orgEntry("ob.board.created", { board: Named }),
  orgEntry("ob.board.deleted", DeletedBoard.properties),
  orgEntry("ob.invitation.created", { id: Type.String(), role: InvitationRole }),
  orgEntry("ob.invitation.revoked", { id: Type.String() }),
  orgEntry("ob.member.added", { principal: Type.String(), role: Role }),
  orgEntry("ob.member.role_changed", { principal: Type.String(), previousRole: Role, role: Role }),
  orgEntry("ob.member.removed", { principal: Type.String(), role: Role }),
]);
export type OrgAuditEvent = Static<typeof OrgAuditEvent>;

export const OrgExportAuditEvent = Type.Union([
  orgEntry("ob.export.requested", { id: Type.String() }),
  orgEntry("ob.export.downloaded", { id: Type.String() }),
]);
export type OrgExportAuditEvent = Static<typeof OrgExportAuditEvent>;

export const readOrgAudit = defineOperation({
  name: "readOrgAudit",
  summary: "Read the organization's audit events (members, roles, invitations, boards) after a cursor, oldest first.",
  route: { method: "GET", path: "/orgs/:org/audit" },
  scope: "org",
  input: {
    params: Type.Object({ org: Slug }),
    query: Type.Object(
      {
        after: Type.Optional(Type.String({ description: "A cursor this route answered; absent, from the start." })),
        exportAfter: Type.Optional(Type.String({ description: "A cursor from exportAudit; absent, from the start." })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 100 })),
      },
      { additionalProperties: false },
    ),
  },
  output: Type.Object({
    events: Type.Array(OrgAuditEvent),
    /** Where the next page starts: pass it back as `after`. */
    cursor: Type.String(),
    exportAudit: Type.Optional(Type.Object({ events: Type.Array(OrgExportAuditEvent), cursor: Type.String() })),
  }),
  errors: ["invalid_cursor", "not_found", "unauthorized", "forbidden"],
  access: null,
  effects: { readOnly: true, idempotent: true, emits: [] },
  cli: false,
  mcp: false,
  why: "Organization administrators read the audit with a browser session.",
  upstream: false,
});
