import {
  type AuditEvent,
  BoardError,
  type OrgAuditEvent,
  type OrgExportAuditEvent,
  type readBoardAudit,
  type readOrgAudit,
} from "@openboard/contract";
import { formatId, grants, isoTime, parseId } from "@openboard/core";
import type { AuditRecord, OrgAuditRecord } from "@openboard/ports";
import { requireManager } from "./connections.ts";
import type { Handler } from "./index.ts";

/**
 * The board's configuration events, oldest first, for the people who manage it: the local owner, a board owner or an
 * organization admin (docs/auth.md "Audit"). Hashes, claim keys and secrets stay in the log.
 */
export const readBoardAuditHandler: Handler<typeof readBoardAudit> = async (ctx, { after, limit = 100 }) => {
  requireManager(ctx, "read the board's audit");
  const position = after === undefined ? 0 : parseId(after);
  if (position === null) throw new BoardError("invalid_cursor", "after: expected a decimal board cursor");
  const { events, head } = await ctx.board.auditEvents(position, limit);
  if (position > head) throw new BoardError("invalid_cursor", "after: cursor is ahead of the board");
  const last = events.at(-1);
  const cursor = events.length === limit && last ? last.id : head;
  return { events: events.map(auditEntry), cursor: formatId(cursor) };
};

/** An event as the audit shows it: what changed and who changed it, never a secret, a hash or a claim key. */
function auditEntry(event: AuditRecord): AuditEvent {
  const common = {
    cursor: formatId(event.id),
    createdAt: isoTime(event.at),
    actor: event.actor,
    principal: event.principal,
  };
  switch (event.type) {
    case "ob.inbound.created":
      return {
        ...common,
        type: event.type,
        payload: { id: event.payload.inbound.id, name: event.payload.inbound.name },
      };
    case "ob.inbound.updated":
    case "ob.inbound.deleted":
      return { ...common, type: event.type, payload: { id: event.payload.id } };
    case "ob.webhook.created":
      return {
        ...common,
        type: event.type,
        payload: { id: event.payload.webhook.id, name: event.payload.webhook.name },
      };
    case "ob.webhook.disabled":
      return {
        ...common,
        type: event.type,
        payload: { id: event.payload.webhook.id, reason: event.payload.webhook.disabledReason },
      };
    case "ob.webhook.updated": {
      const { id, name, enabled } = event.payload.webhook;
      return { ...common, type: event.type, payload: { id, name, enabled } };
    }
    case "ob.webhook.deleted":
      return { ...common, type: event.type, payload: { id: event.payload.id } };
    case "ob.schema.registered":
      return { ...common, type: event.type, payload: { id: event.payload.id } };
    case "ob.watchers.registered":
      return { ...common, type: event.type, payload: { owner: event.payload.owner } };
    case "ob.grant.revoked":
      return { ...common, type: event.type, payload: { grant: event.payload.grant } };
    case "ob.grant.created":
    case "ob.grant.updated":
      return { ...common, type: event.type, payload: { grant: event.payload.grant } };
    case "ob.connection.created": {
      const { connection, claims, by } = event.payload;
      // Creations recorded before `claims` existed carry none: no limit.
      return { ...common, type: event.type, payload: { connection, claims: claims ?? null, by } };
    }
    case "ob.connection.revoked": {
      const { connection, grant } = event.payload;
      return { ...common, type: event.type, payload: { connection, grant: grants.formatGrantId(grant) } };
    }
    case "ob.connection.rotated": {
      const { connection, secretHint, previousUntil } = event.payload;
      const until = previousUntil === null ? null : isoTime(previousUntil);
      return { ...common, type: event.type, payload: { connection, secretHint, previousUntil: until } };
    }
    case "ob.agent.claimed": {
      const { agent, connection, profile, by } = event.payload;
      return { ...common, type: event.type, payload: { agent, connection, profile, by } };
    }
    case "ob.agent.refreshed": {
      const { agent, tokenExpires, previousUntil, by } = event.payload;
      const payload = { agent, expiresAt: isoTime(tokenExpires), previousUntil: isoTime(previousUntil), by };
      return { ...common, type: event.type, payload };
    }
    case "ob.agent.revoked": {
      const { connection, agent } = event.payload;
      return { ...common, type: event.type, payload: { connection, agent } };
    }
  }
}

/** The payload fields each organization event shows; anything else its record holds stays in the log. */
const ORG_PAYLOAD: { readonly [Type in OrgAuditEvent["type"]]: readonly string[] } = {
  "ob.operator.quota_changed": ["quota", "previousLimit", "limit", "reason"],
  "ob.operator.deleted": ["reason"],
  "ob.operator.undeleted": ["reason"],
  "ob.org.created": ["org", "owner"],
  "ob.org.deleted": ["org", "deletedAt", "purgeAt"],
  "ob.board.created": ["board"],
  "ob.board.deleted": ["board", "deletedAt"],
  "ob.invitation.created": ["id", "role"],
  "ob.invitation.revoked": ["id"],
  "ob.member.added": ["principal", "role"],
  "ob.member.role_changed": ["principal", "previousRole", "role"],
  "ob.member.removed": ["principal", "role"],
};

/**
 * The organization's events, oldest first, for its owners and admins (docs/auth.md "Audit"): who joined, who invited
 * whom, who changed roles. The pipeline answers 403 `forbidden` to a member and 404 to anyone outside it.
 */
export const readOrgAuditHandler: Handler<typeof readOrgAudit> = async (ctx, { after, exportAfter, limit = 100 }) => {
  const position = after === undefined ? 0 : parseId(after);
  const exportPosition = exportAfter === undefined ? 0 : parseId(exportAfter);
  if (position === null || exportPosition === null)
    throw new BoardError("invalid_cursor", "expected a decimal audit cursor");
  const { events, head } = await ctx.org.auditEvents(position, limit);
  if (position > head) throw new BoardError("invalid_cursor", "after: cursor is ahead of the organization");
  const last = events.at(-1);
  const cursor = events.length === limit && last ? last.id : head;
  const exports = await ctx.org.exportAudit(exportPosition, limit);
  if (exportPosition > exports.head)
    throw new BoardError("invalid_cursor", "exportAfter: cursor is ahead of the export audit");
  const exportAudit =
    exports.head === 0
      ? undefined
      : {
          cursor: formatId(exports.events.at(-1)?.id ?? exports.head),
          events: exports.events.map(
            ({ id, type, at, actor, payload }) =>
              ({ cursor: formatId(id), type, createdAt: isoTime(at), actor, payload }) as OrgExportAuditEvent,
          ),
        };
  return { events: events.map(orgAuditEntry), cursor: formatId(cursor), ...(exportAudit && { exportAudit }) };
};

function orgAuditEntry({ id, type, at, actor, payload }: OrgAuditRecord): OrgAuditEvent {
  const fields = Object.hasOwn(ORG_PAYLOAD, type) ? ORG_PAYLOAD[type as OrgAuditEvent["type"]] : undefined;
  // A new organization event type needs its audit shape here before it is written.
  if (!fields) throw new Error(`organization event ${type} has no audit shape`);
  const shown = Object.fromEntries(fields.map((field) => [field, payload[field]]));
  return { cursor: formatId(id), type, createdAt: isoTime(at), actor, payload: shown } as OrgAuditEvent;
}
