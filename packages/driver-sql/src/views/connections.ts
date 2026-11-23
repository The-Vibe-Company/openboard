import type { Can, Connection } from "@openboard/contract";
import { type ConnectionCreated, connections, type GrantPrincipal, grants, isoTime } from "@openboard/core";
import type { BoardKeys, BoardScope, BoardView, ConnectionRecord } from "@openboard/ports";
import type { Db, Dialect, Row } from "../db.ts";
import { query, sql } from "../sql.ts";

/** A claimed token's lifetime and hard cap until the connection names its own (docs/auth.md "Connections"). */
const TOKEN_TTL_S = 3600;
const TOKEN_MAX_S = 86_400;

export const connectionStatements = {
  nextGrant: sql`SELECT next_grant FROM boards WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
  setNextGrant: sql`UPDATE boards SET next_grant = ${"nextGrant"} WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
  connectionNamed: sql`SELECT id FROM connections WHERE board_id = ${"boardId"} AND name = ${"name"}`,
  insertGrant: sql`INSERT INTO grants (org_id, board_id, id, principals, can, capped, by, at)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"principals"}, ${"can"}, 0, ${"by"}, ${"at"})`,
  insertGrantPrincipal: sql`INSERT INTO grant_principals (board_id, grant_id, kind, key, detail)
    VALUES (${"boardId"}, ${"grantId"}, ${"kind"}, ${"key"}, ${"detail"})`,
  insertConnection: sql`INSERT INTO connections (id, org_id, board_id, name, secret_hash, secret_hint, direct,
    profiles, token_ttl_s, token_max_s, created_by, created_at) VALUES (${"id"}, ${"orgId"}, ${"boardId"},
    ${"name"}, ${"secretHash"}, ${"secretHint"}, ${"direct"}, ${"profiles"}, ${"tokenTtl"}, ${"tokenMax"},
    ${"createdBy"}, ${"at"})`,
  /** The connection with the first grant naming it: the one created with it. */
  connectionById: sql`SELECT c.id, c.name, c.secret_hash, c.secret_hint, c.direct, c.profiles, c.token_ttl_s,
    c.token_max_s, c.created_by, c.created_at, g.id AS grant_id, g.principals, g.can
    FROM connections c JOIN grant_principals p ON p.board_id = c.board_id AND p.kind = 'connection' AND p.key = c.id
      JOIN grants g ON g.board_id = p.board_id AND g.id = p.grant_id
    WHERE c.org_id = ${"orgId"} AND c.board_id = ${"boardId"} AND c.id = ${"id"} ORDER BY g.id LIMIT 1`,
};

/** Reads the next grant ID under the caller's board lock. */
export async function nextGrant(tx: Db, dialect: Dialect, keys: BoardKeys): Promise<number> {
  const [row] = await query(tx, dialect, connectionStatements.nextGrant, keys);
  if (!row) throw new Error(`board ${keys.boardId} of organization ${keys.orgId} is missing`);
  return Number(row.next_grant);
}

export async function connectionNamed(tx: Db, dialect: Dialect, keys: BoardKeys, name: string): Promise<boolean> {
  const rows = await query(tx, dialect, connectionStatements.connectionNamed, { boardId: keys.boardId, name });
  return rows.length > 0;
}

/** The fold of `ob.connection.created`: the connection's row, its grant and the grant's principals. */
export async function foldConnectionCreated(tx: Db, dialect: Dialect, keys: BoardKeys, event: ConnectionCreated) {
  const { connection, grant, secretHash } = event.payload;
  await query(tx, dialect, connectionStatements.insertGrant, {
    ...keys,
    id: grant.id,
    principals: JSON.stringify(grant.principals),
    can: JSON.stringify(grant.can),
    by: event.actor,
    at: event.at,
  });
  for (const principal of grant.principals) {
    await query(tx, dialect, connectionStatements.insertGrantPrincipal, {
      boardId: keys.boardId,
      grantId: grant.id,
      kind: principal.kind,
      key: principal.connection,
      detail: JSON.stringify(principal),
    });
  }
  await query(tx, dialect, connectionStatements.setNextGrant, { ...keys, nextGrant: grant.id + 1 });
  await query(tx, dialect, connectionStatements.insertConnection, {
    ...keys,
    id: connection.id,
    name: connection.name,
    secretHash: Uint8Array.from(Buffer.from(secretHash, "hex")),
    secretHint: connection.secretHint,
    direct: connection.direct ? 1 : 0,
    profiles: JSON.stringify(connection.profiles),
    tokenTtl: TOKEN_TTL_S,
    tokenMax: TOKEN_MAX_S,
    createdBy: connection.createdBy,
    at: event.at,
  });
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
    secretHint: String(row.secret_hint),
    createdBy: String(row.created_by),
    createdAt: isoTime(Number(row.created_at)),
  };
  const principals = JSON.parse(String(row.principals)) as GrantPrincipal[];
  const secretHash = Buffer.from(row.secret_hash as Uint8Array).toString("hex");
  const tokenTtl = Number(row.token_ttl_s);
  const tokenMax = Number(row.token_max_s);
  return { connection, grant: { id: grantId, principals, can }, secretHash, tokenTtl, tokenMax };
}

export function connectionReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "connection"> {
  return {
    async connection(id) {
      const params = { orgId: scope.orgId, boardId: scope.boardId, id };
      const [row] = await query(db, dialect, connectionStatements.connectionById, params);
      return row ? recordOf(row) : null;
    },
  };
}
