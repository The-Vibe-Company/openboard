import { type AuditEvent, BoardError, type readBoardAudit } from "@openboard/contract";
import { formatId, grants, isoTime, parseId } from "@openboard/core";
import type { AuditRecord } from "@openboard/ports";
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
