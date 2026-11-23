import type { Can } from "@openboard/contract";
import { type AgentClaimed, isoTime } from "@openboard/core";
import type { AgentRecord, BoardKeys, BoardScope, BoardView } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { query, sql } from "../sql.ts";

export const agentStatements = {
  insertAgent: sql`INSERT INTO connection_agents (id, org_id, board_id, connection, profile, profile_key, can,
    token_hash, token_expires, hard_expires, created_at) VALUES (${"id"}, ${"orgId"}, ${"boardId"}, ${"connection"},
    ${"profile"}, ${"profileKey"}, ${"can"}, ${"tokenHash"}, ${"tokenExpires"}, ${"hardExpires"}, ${"at"})`,
  /** The agent with the connection it was claimed from, which lives on the same board. */
  agentById: sql`SELECT a.id, a.connection, a.profile, a.profile_key, a.can, a.token_hash, a.token_expires,
    a.hard_expires, c.name, c.profiles
    FROM connection_agents a JOIN connections c ON c.board_id = a.board_id AND c.id = a.connection
    WHERE a.org_id = ${"orgId"} AND a.board_id = ${"boardId"} AND a.id = ${"id"}`,
};

/** The fold of `ob.agent.claimed`: the agent's row, holding its token's hash, never the token. */
export async function foldAgentClaimed(tx: Db, dialect: Dialect, keys: BoardKeys, event: AgentClaimed) {
  const { agent, connection, profile, tokenHash, tokenExpires, hardExpires } = event.payload;
  await query(tx, dialect, agentStatements.insertAgent, {
    ...keys,
    id: agent.id,
    connection,
    profile,
    profileKey: profile.toLowerCase(),
    can: JSON.stringify(agent.can),
    tokenHash: Uint8Array.from(Buffer.from(tokenHash, "hex")),
    tokenExpires,
    hardExpires,
    at: event.at,
  });
}

function recordOf(row: Row): AgentRecord {
  const connection = String(row.connection);
  return {
    agent: {
      id: String(row.id),
      actor: `ob:conn:${connection}+${String(row.profile_key)}`,
      can: JSON.parse(String(row.can)) as Can,
      expiresAt: isoTime(Number(row.token_expires)),
      hardExpiresAt: isoTime(Number(row.hard_expires)),
    },
    connection: { id: connection, name: String(row.name), profiles: JSON.parse(String(row.profiles)) as string[] },
    profile: String(row.profile),
    tokenHash: Buffer.from(row.token_hash as Uint8Array).toString("hex"),
  };
}

export function agentReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "agent"> {
  return {
    async agent(id) {
      const params = { orgId: scope.orgId, boardId: scope.boardId, id };
      const [row] = await query(db, dialect, agentStatements.agentById, params);
      return row ? recordOf(row) : null;
    },
  };
}
