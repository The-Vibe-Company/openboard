import type { Can } from "@openboard/contract";
import { type AgentClaimed, type AgentRefreshed, isoTime } from "@openboard/core";
import type { AgentRecord, BoardKeys, BoardScope, BoardView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { query, sql } from "../sql.ts";
import { spendClaim } from "./connections.ts";
import { connectionGrantCans, grantCanArray } from "./grants.ts";

export const agentStatements = {
  insertAgent: sql`INSERT INTO connection_agents (id, org_id, board_id, connection, profile, profile_key, can,
    token_hash, token_expires, hard_expires, created_at, claim_key) VALUES (${"id"}, ${"orgId"}, ${"boardId"}, ${"connection"},
    ${"profile"}, ${"profileKey"}, ${"can"}, ${"tokenHash"}, ${"tokenExpires"}, ${"hardExpires"}, ${"at"}, ${"claimKey"})`,
  /** The agent with the connection it was claimed from, which lives on the same board. */
  agentCredential: sql`SELECT a.id, a.connection, a.profile, a.profile_key, a.can, a.token_hash, a.prev_hash,
    a.prev_until, a.token_expires, a.hard_expires, a.revoked_at, c.name, c.profiles, c.token_ttl_s,
    (SELECT ${grantCanArray} FROM grants g
      WHERE g.org_id = ${"orgId"} AND g.board_id = ${"boardId"} AND g.revoked = 0
        AND g.id IN (SELECT p.grant_id FROM grant_principals p WHERE p.board_id = ${"boardId"}
          AND ((p.kind = 'connection' AND p.key = c.id) OR (p.kind = 'all-connections' AND p.key = '')))) AS grant_cans
    FROM connection_agents a JOIN connections c ON c.board_id = a.board_id AND c.id = a.connection
    WHERE a.org_id = ${"orgId"} AND a.board_id = ${"boardId"}
      AND ((a.id = ${"id"} AND a.revoked_at IS NULL)
        OR (a.connection = ${"connection"} AND a.claim_key = ${"claimKey"}))`,
  refreshAgent: sql`UPDATE connection_agents SET token_hash = ${"tokenHash"}, prev_hash = ${"previousHash"},
    prev_until = ${"previousUntil"}, token_expires = ${"tokenExpires"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
};

const bytesOf = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const hexOf = (bytes: unknown) => Buffer.from(bytes as Uint8Array).toString("hex");

/** The fold of `ob.agent.claimed`: the agent's row, holding its token's hash, never the token; one more claim counted. */
export async function foldAgentClaimed(tx: Db, dialect: Dialect, keys: BoardKeys, event: AgentClaimed) {
  const { agent, connection, profile, tokenHash, tokenExpires, hardExpires } = event.payload;
  await query(tx, dialect, agentStatements.insertAgent, {
    ...keys,
    id: agent.id,
    connection,
    profile,
    profileKey: profile.toLowerCase(),
    can: JSON.stringify(agent.can),
    tokenHash: bytesOf(tokenHash),
    tokenExpires,
    hardExpires,
    at: event.at,
    claimKey: event.payload.claimKey ?? null,
  });
  await spendClaim(tx, dialect, keys, connection);
}

/** The fold of `ob.agent.refreshed`: the new token's hash, and its predecessor's until it stops working. */
export async function foldAgentRefreshed(tx: Db, dialect: Dialect, keys: BoardKeys, event: AgentRefreshed) {
  const { agent, tokenHash, previousHash, previousUntil, tokenExpires } = event.payload;
  await query(tx, dialect, agentStatements.refreshAgent, {
    ...keys,
    id: agent,
    tokenHash: bytesOf(tokenHash),
    previousHash: bytesOf(previousHash),
    previousUntil,
    tokenExpires,
  });
}

function recordOf(row: Row): AgentRecord {
  const connection = String(row.connection);
  const previous = row.prev_hash == null ? null : { tokenHash: hexOf(row.prev_hash), until: Number(row.prev_until) };
  return {
    grantCans: connectionGrantCans(row.grant_cans),
    agent: {
      id: String(row.id),
      actor: `ob:conn:${connection}+${String(row.profile_key)}`,
      can: JSON.parse(String(row.can)) as Can,
      expiresAt: isoTime(Number(row.token_expires)),
      hardExpiresAt: isoTime(Number(row.hard_expires)),
    },
    connection: {
      id: connection,
      name: String(row.name),
      profiles: JSON.parse(String(row.profiles)) as string[],
      tokenTtl: Number(row.token_ttl_s),
    },
    profile: String(row.profile),
    tokenHash: hexOf(row.token_hash),
    tokenExpires: Number(row.token_expires),
    hardExpires: Number(row.hard_expires),
    previous,
  };
}

/** The agent with the ID on the board `keys` names, read with the caller's connection or transaction. */
export async function findAgent(db: Db, dialect: Dialect, keys: BoardKeys, id: string): Promise<AgentRecord | null> {
  const [row] = await query(db, dialect, agentStatements.agentCredential, {
    ...keys,
    id,
    connection: null,
    claimKey: null,
  });
  return row ? recordOf(row) : null;
}

/** A claim key is reserved for its agent even after the agent expires or is revoked. */
export async function findAgentByClaimKey(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
  connection: string,
  claimKey: string,
) {
  const [row] = await query(db, dialect, agentStatements.agentCredential, { ...keys, id: null, connection, claimKey });
  return row ? { record: recordOf(row), revoked: row.revoked_at != null } : null;
}

export function agentReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "agent"> {
  return {
    agent: (id) => findAgent(db, dialect, scope, id),
  };
}
