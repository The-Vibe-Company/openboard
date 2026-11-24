import { BoardError } from "@openboard/contract";
import type { InboundConfig, InboundEvent } from "@openboard/core";
import type { BoardInboundReads, BoardInboundWriter, BoardKeys, InboundRecord } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { query, sql } from "../../sql.ts";
import { exhaustedQuota } from "../orgs.ts";

export const inboundStatements = {
  inboundEndpoints: sql`SELECT config, grant_id FROM inbound_endpoints
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} ORDER BY id`,
  inboundEndpoint: sql`SELECT config, grant_id FROM inbound_endpoints
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  inboundSeen: sql`SELECT result FROM inbound_seen
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND endpoint = ${"endpoint"} AND event_id = ${"eventId"}`,
  insertInboundSeen: sql`INSERT INTO inbound_seen (org_id, board_id, endpoint, event_id, at, result)
    SELECT ${"orgId"}, ${"boardId"}, id, ${"eventId"}, ${"at"}, ${"result"} FROM inbound_endpoints
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"endpoint"} RETURNING endpoint`,
  inboundQuota: sql`SELECT o.quotas, (SELECT COUNT(*) FROM inbound_endpoints
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}) AS count
    FROM boards b JOIN orgs o ON o.id = b.org_id WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"}`,
  insertInbound: sql`INSERT INTO inbound_endpoints (org_id, board_id, id, name, grant_id, config)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"name"}, ${"grantId"}, ${"config"})`,
  updateInbound: sql`UPDATE inbound_endpoints SET config = ${"config"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  deleteInbound: sql`DELETE FROM inbound_endpoints
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  storeInboundSecret: sql`INSERT INTO inbound_secrets (org_id, board_id, id, key_version, ciphertext)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"keyVersion"}, ${"ciphertext"})`,
  inboundSecret: sql`SELECT key_version, ciphertext FROM inbound_secrets
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  deleteInboundSecret: sql`DELETE FROM inbound_secrets
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
};

function record(row: Row): InboundRecord {
  return { inbound: JSON.parse(String(row.config)) as InboundConfig, grantId: Number(row.grant_id) };
}

export function inboundReads(db: Db, dialect: Dialect, keys: BoardKeys): BoardInboundReads {
  return {
    async inboundEndpoints() {
      return (await query(db, dialect, inboundStatements.inboundEndpoints, keys)).map(record);
    },
    async inboundEndpoint(id) {
      const [row] = await query(db, dialect, inboundStatements.inboundEndpoint, { ...keys, id });
      return row ? record(row) : null;
    },
    async inboundSecret(id) {
      const [row] = await query(db, dialect, inboundStatements.inboundSecret, { ...keys, id });
      return row ? { keyVersion: Number(row.key_version), ciphertext: String(row.ciphertext) } : null;
    },
  };
}

export function inboundWriter(db: Db, dialect: Dialect, keys: BoardKeys): BoardInboundWriter {
  return {
    ...inboundReads(db, dialect, keys),
    async inboundSeen(endpoint, eventId) {
      const [row] = await query(db, dialect, inboundStatements.inboundSeen, { ...keys, endpoint, eventId });
      return row ? String(row.result) : null;
    },
    async recordInboundSeen(endpoint, eventId, at, result) {
      const [row] = await query(db, dialect, inboundStatements.insertInboundSeen, {
        ...keys,
        endpoint,
        eventId,
        at,
        result,
      });
      if (!row) throw new BoardError("not_found", "no such inbound endpoint");
    },
    async inboundQuota() {
      const [row] = await query(db, dialect, inboundStatements.inboundQuota, keys);
      return exhaustedQuota("inbound", row?.quotas, row?.count);
    },
    async storeInboundSecret(id, secret) {
      await query(db, dialect, inboundStatements.storeInboundSecret, { ...keys, id, ...secret });
    },
  };
}

export async function foldInbound(db: Db, dialect: Dialect, keys: BoardKeys, event: InboundEvent) {
  if (event.type === "ob.inbound.created") {
    const { inbound, grantId } = event.payload;
    await query(db, dialect, inboundStatements.insertInbound, {
      ...keys,
      id: inbound.id,
      name: inbound.name,
      grantId,
      config: JSON.stringify(inbound),
    });
  } else if (event.type === "ob.inbound.updated") {
    const { id, rules, rulePlan } = event.payload;
    const current = await inboundReads(db, dialect, keys).inboundEndpoint(id);
    if (!current) throw new Error("missing inbound endpoint");
    await query(db, dialect, inboundStatements.updateInbound, {
      ...keys,
      id,
      config: JSON.stringify({ ...current.inbound, rules, rulePlan }),
    });
  } else {
    const scope = { ...keys, id: event.payload.id };
    await query(db, dialect, inboundStatements.deleteInboundSecret, scope);
    await query(db, dialect, inboundStatements.deleteInbound, scope);
  }
}
