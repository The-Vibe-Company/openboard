import type { Can, Connection, ConnectionAgent, ManagedConnection } from "@openboard/contract";
import {
  type AgentRevoked,
  type ConnectionCreated,
  type ConnectionRevoked,
  type ConnectionRotated,
  connections,
  type GrantPrincipal,
  grants,
  isoTime,
  resolveCan,
} from "@openboard/core";
import type { BoardKeys, BoardScope, BoardView, ConnectionRecord } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { type Fragment, query, sql } from "../sql.ts";
import { codePointOrder } from "./channels.ts";
import { connectionGrantCans, grantCanArray, grantStatements } from "./grants.ts";
import { exhaustedQuota } from "./orgs.ts";

/** A claimed token's lifetime and hard cap until the connection names its own (docs/auth.md "Connections"). */
const TOKEN_TTL_S = 3600;
const TOKEN_MAX_S = 86_400;

/**
 * SQLite plans without statistics and would walk the board's whole log by primary key instead of the partial index of
 * connection writes, so it is named there; Postgres picks it from its statistics.
 */
const byConnectionIndex: Fragment = Object.freeze({
  fragment: (dialect: Dialect) => (dialect.name === "sqlite" ? " INDEXED BY events_connection" : ""),
});

export const connectionStatements = {
  connectionCount: sql`SELECT o.quotas, (SELECT COUNT(*) FROM connections
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND revoked_at IS NULL) AS count
    FROM boards b JOIN orgs o ON o.id = b.org_id WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"}`,
  connectionNamed: sql`SELECT id FROM connections WHERE board_id = ${"boardId"} AND name = ${"name"}`,
  insertConnection: sql`INSERT INTO connections (id, org_id, board_id, name, secret_hash, secret_hint, direct,
    claims_max, profiles, token_ttl_s, token_max_s, created_by, created_at) VALUES (${"id"}, ${"orgId"},
    ${"boardId"}, ${"name"}, ${"secretHash"}, ${"secretHint"}, ${"direct"}, ${"claimsMax"}, ${"profiles"},
    ${"tokenTtl"}, ${"tokenMax"}, ${"createdBy"}, ${"at"})`,
  /** One more claim made with the connection's secret, in the claim's transaction. */
  spendClaim: sql`UPDATE connections SET claims_used = claims_used + 1
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  /** The connection's unrevoked agent pinned to the profile whose token expires last: the one that may still hold it. */
  profileHolder: sql`SELECT id, token_expires FROM connection_agents
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND connection = ${"connection"}
      AND profile_key = ${"profileKey"} AND revoked_at IS NULL
    ORDER BY token_expires DESC LIMIT 1`,
  revokeConnection: sql`UPDATE connections SET revoked_at = ${"at"}, revoked_by = ${"by"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  revokeConnectionAgents: sql`UPDATE connection_agents SET revoked_at = ${"at"}, revoked_by = ${"by"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND connection = ${"id"} AND revoked_at IS NULL`,
  revokeAgent: sql`UPDATE connection_agents SET revoked_at = ${"at"}, revoked_by = ${"by"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND connection = ${"connection"} AND id = ${"agent"}
      AND revoked_at IS NULL`,
  /** The new secret; the one it replaces moves to `prev_secret_hash`, working until `prev_secret_until` if not null. */
  rotateSecret: sql`UPDATE connections SET prev_secret_hash = secret_hash, prev_secret_until = ${"until"},
    secret_hash = ${"secretHash"}, secret_hint = ${"secretHint"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"} AND revoked_at IS NULL`,
  /** The active connection with the first grant naming it: the one created with it. */
  connectionById: sql`SELECT c.id, c.name, c.secret_hash, c.secret_hint, c.prev_secret_hash, c.prev_secret_until, c.direct, c.claims_max, c.claims_used,
    c.profiles, c.token_ttl_s, c.token_max_s, c.created_by, c.created_at, g.id AS grant_id, g.principals, g.can,
    (SELECT ${grantCanArray} FROM grants g
      WHERE g.org_id = ${"orgId"} AND g.board_id = ${"boardId"} AND g.revoked = 0
        AND g.id IN (SELECT p.grant_id FROM grant_principals p WHERE p.board_id = ${"boardId"}
          AND ((p.kind = 'connection' AND p.key = c.id) OR (p.kind = 'all-connections' AND p.key = '')))) AS grant_cans
    FROM connections c JOIN grant_principals p ON p.board_id = c.board_id AND p.kind = 'connection' AND p.key = c.id
      JOIN grants g ON g.board_id = p.board_id AND g.id = p.grant_id
    WHERE c.org_id = ${"orgId"} AND c.board_id = ${"boardId"} AND c.id = ${"id"} AND c.revoked_at IS NULL ORDER BY g.id LIMIT 1`,
  /**
   * The board's active connections by name, each with the first grant naming it and the time of its latest event,
   * found through the partial index `events_connection`, which the `LIKE` term, the index's own predicate, unlocks.
   */
  managedConnections: sql`SELECT c.id, c.name, c.secret_hint, c.direct, c.profiles, c.created_by, c.created_at,
    g.id AS grant_id, g.can, (SELECT e.at FROM events e${byConnectionIndex} WHERE e.org_id = ${"orgId"} AND e.board_id = ${"boardId"}
      AND e.principal LIKE 'ob:conn:%' AND e.principal = 'ob:conn:' || c.id ORDER BY e.id DESC LIMIT 1) AS last_used
    FROM connections c JOIN grants g ON g.org_id = c.org_id AND g.board_id = c.board_id
      AND g.id = (SELECT MIN(p.grant_id) FROM grant_principals p
        WHERE p.board_id = ${"boardId"} AND p.kind = 'connection' AND p.key = c.id)
    WHERE c.org_id = ${"orgId"} AND c.board_id = ${"boardId"} AND c.revoked_at IS NULL
      AND (c.id = ${"id"} OR ${"all"} = 1)
    ORDER BY c.name${codePointOrder}`,
  /** The live agents (unrevoked, token unexpired: D50) of the board's active connections, or of one, oldest first. */
  managedAgents: sql`SELECT a.id, a.connection, a.profile, a.profile_key, a.can, a.token_expires, a.hard_expires,
    a.created_at FROM connection_agents a
    WHERE a.org_id = ${"orgId"} AND a.board_id = ${"boardId"} AND a.revoked_at IS NULL AND a.token_expires > ${"now"}
      AND (a.connection = ${"id"} OR ${"all"} = 1)
    ORDER BY a.created_at, a.id`,
};

/** Reads the next grant ID under the caller's board lock. */
export async function nextGrant(tx: Db, dialect: Dialect, keys: BoardKeys): Promise<number> {
  const [row] = await query(tx, dialect, grantStatements.nextGrant, keys);
  if (!row) throw new Error(`board ${keys.boardId} of organization ${keys.orgId} is missing`);
  return Number(row.next_grant);
}

export async function connectionQuota(tx: Db, dialect: Dialect, keys: BoardKeys) {
  const [usage] = await query(tx, dialect, connectionStatements.connectionCount, keys);
  return exhaustedQuota("connections", usage?.quotas, usage?.count);
}

export async function connectionNamed(tx: Db, dialect: Dialect, keys: BoardKeys, name: string): Promise<boolean> {
  const rows = await query(tx, dialect, connectionStatements.connectionNamed, { boardId: keys.boardId, name });
  return rows.length > 0;
}

/** The fold of `ob.connection.created`: the connection's row, its grant and the grant's principals. */
export async function foldConnectionCreated(tx: Db, dialect: Dialect, keys: BoardKeys, event: ConnectionCreated) {
  const { connection, grant, secretHash, claims } = event.payload;
  await query(tx, dialect, grantStatements.insertGrant, {
    ...keys,
    id: grant.id,
    principals: JSON.stringify(grant.principals),
    can: JSON.stringify(grant.can),
    by: event.actor,
    at: event.at,
  });
  for (const principal of grant.principals) {
    await query(tx, dialect, grantStatements.insertGrantPrincipal, {
      boardId: keys.boardId,
      grantId: grant.id,
      kind: principal.kind,
      key: principal.connection,
      detail: JSON.stringify(principal),
    });
  }
  await query(tx, dialect, grantStatements.setNextGrant, { ...keys, nextGrant: grant.id + 1 });
  await query(tx, dialect, connectionStatements.insertConnection, {
    ...keys,
    id: connection.id,
    name: connection.name,
    secretHash: Uint8Array.from(Buffer.from(secretHash, "hex")),
    secretHint: connection.secretHint,
    direct: connection.direct ? 1 : 0,
    claimsMax: claims,
    profiles: JSON.stringify(connection.profiles),
    tokenTtl: TOKEN_TTL_S,
    tokenMax: TOKEN_MAX_S,
    createdBy: connection.createdBy,
    at: event.at,
  });
}

/** The hint as shown: `…` and the secret's last four characters, also for hints stored with the `obc_` prefix (D51). */
function hintOf(row: Row): string {
  return `…${String(row.secret_hint).slice(-4)}`;
}

function recordOf(row: Row): ConnectionRecord {
  const id = String(row.id);
  const grantId = Number(row.grant_id);
  const can = JSON.parse(String(row.can)) as Can;
  const connection: Connection = {
    id,
    principal: connections.connectionPrincipal(id),
    name: String(row.name),
    grant: grants.formatGrantId(grantId),
    can,
    direct: Number(row.direct) === 1,
    profiles: JSON.parse(String(row.profiles)) as string[],
    secretHint: hintOf(row),
    createdBy: String(row.created_by),
    createdAt: isoTime(Number(row.created_at)),
  };
  const principals = JSON.parse(String(row.principals)) as GrantPrincipal[];
  const secretHash = Buffer.from(row.secret_hash as Uint8Array).toString("hex");
  const tokenTtl = Number(row.token_ttl_s);
  const tokenMax = Number(row.token_max_s);
  const claims = { max: row.claims_max == null ? null : Number(row.claims_max), used: Number(row.claims_used) };
  const previous =
    row.prev_secret_until == null || row.prev_secret_hash == null
      ? null
      : {
          secretHash: Buffer.from(row.prev_secret_hash as Uint8Array).toString("hex"),
          until: Number(row.prev_secret_until),
        };
  return {
    connection,
    effectiveCan: resolveCan(connectionGrantCans(row.grant_cans).map(grants.compileCan)),
    grant: { id: grantId, principals, can },
    secretHash,
    previous,
    tokenTtl,
    tokenMax,
    claims,
  };
}

/** The connection with the ID on the board `keys` names, read with the caller's connection or transaction. */
export async function findConnection(db: Db, dialect: Dialect, keys: BoardKeys, id: string) {
  const params = { orgId: keys.orgId, boardId: keys.boardId, id };
  const [row] = await query(db, dialect, connectionStatements.connectionById, params);
  return row ? recordOf(row) : null;
}

/** Counts a claim made with the connection's secret; the fold of `ob.agent.claimed` runs it in the claim's write. */
export async function spendClaim(tx: Db, dialect: Dialect, keys: BoardKeys, id: string): Promise<void> {
  await query(tx, dialect, connectionStatements.spendClaim, { ...keys, id });
}

/** The connection's agent that may still hold the profile, read under the caller's board lock (docs/auth.md mode 2). */
export async function profileHolder(tx: Db, dialect: Dialect, keys: BoardKeys, connection: string, profile: string) {
  const params = { ...keys, connection, profileKey: profile.toLowerCase() };
  const [row] = await query(tx, dialect, connectionStatements.profileHolder, params);
  return row ? { id: String(row.id), tokenExpires: Number(row.token_expires) } : null;
}

function managedAgentOf(row: Row): ConnectionAgent {
  return {
    id: String(row.id),
    actor: `${connections.connectionPrincipal(String(row.connection))}+${String(row.profile_key)}`,
    can: JSON.parse(String(row.can)) as Can,
    expiresAt: isoTime(Number(row.token_expires)),
    hardExpiresAt: isoTime(Number(row.hard_expires)),
    profile: String(row.profile),
    createdAt: isoTime(Number(row.created_at)),
  };
}

function managedOf(row: Row, agents: readonly ConnectionAgent[]): ManagedConnection {
  const id = String(row.id);
  return {
    id,
    principal: connections.connectionPrincipal(id),
    name: String(row.name),
    grant: grants.formatGrantId(Number(row.grant_id)),
    can: JSON.parse(String(row.can)) as Can,
    direct: Number(row.direct) === 1,
    profiles: JSON.parse(String(row.profiles)) as string[],
    secretHint: hintOf(row),
    createdBy: String(row.created_by),
    createdAt: isoTime(Number(row.created_at)),
    lastUsedAt: row.last_used == null ? null : isoTime(Number(row.last_used)),
    agents: [...agents],
  };
}

/**
 * The active connections `id` selects (all of them when null), each with its live agents at `now`. Two reads, no
 * lock: an agent claimed or a connection revoked between them shows on the next read, never another connection's.
 */
async function managedConnections(db: Db, dialect: Dialect, keys: BoardKeys, id: string | null, now: number) {
  const params = { orgId: keys.orgId, boardId: keys.boardId, id: id ?? "", all: id === null ? 1 : 0 };
  const rows = await query(db, dialect, connectionStatements.managedConnections, params);
  if (rows.length === 0) return [];
  const agentRows = await query(db, dialect, connectionStatements.managedAgents, { ...params, now });
  const agents = new Map<string, ConnectionAgent[]>();
  for (const row of agentRows) {
    const list = agents.get(String(row.connection)) ?? [];
    list.push(managedAgentOf(row));
    agents.set(String(row.connection), list);
  }
  return rows.map((row) => managedOf(row, agents.get(String(row.id)) ?? []));
}

export function connectionReads(
  db: Db,
  dialect: Dialect,
  scope: BoardScope,
): Pick<BoardView, "connection" | "listConnections" | "managedConnection"> {
  return {
    connection: (id) => findConnection(db, dialect, scope, id),
    listConnections: (now) => managedConnections(db, dialect, scope, null, now),
    managedConnection: async (id, now) => (await managedConnections(db, dialect, scope, id, now))[0] ?? null,
  };
}

/** Folds revocation of the connection, its grant and all its agents in the event's transaction. */
export async function foldConnectionRevoked(tx: Db, dialect: Dialect, keys: BoardKeys, event: ConnectionRevoked) {
  const { connection: id, grant } = event.payload;
  const params = { ...keys, id, at: event.at, by: event.actor };
  await query(tx, dialect, connectionStatements.revokeConnection, params);
  await query(tx, dialect, grantStatements.revokeGrant, { ...keys, id: grant });
  await query(tx, dialect, connectionStatements.revokeConnectionAgents, params);
}

/** Folds revocation of one agent in the event's transaction; its connection and other agents stay as they are. */
export async function foldAgentRevoked(tx: Db, dialect: Dialect, keys: BoardKeys, event: AgentRevoked) {
  const { connection, agent } = event.payload;
  await query(tx, dialect, connectionStatements.revokeAgent, {
    ...keys,
    connection,
    agent,
    at: event.at,
    by: event.actor,
  });
}

/** Folds a rotation: the new secret's hash and hint, and the replaced one kept until the overlap ends, if any. */
export async function foldConnectionRotated(tx: Db, dialect: Dialect, keys: BoardKeys, event: ConnectionRotated) {
  const { connection: id, secretHash, secretHint, previousUntil } = event.payload;
  await query(tx, dialect, connectionStatements.rotateSecret, {
    ...keys,
    id,
    secretHash: Uint8Array.from(Buffer.from(secretHash, "hex")),
    secretHint,
    until: previousUntil,
  });
}
