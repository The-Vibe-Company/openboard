import type { CanInput, GrantPrincipal, GrantView } from "@openboard/contract";
import { type GrantCreated, type GrantRevoked, type GrantUpdated, grants, isoTime } from "@openboard/core";
import type { BoardGrantReads, BoardKeys } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { type Fragment, query, sql } from "../sql.ts";

/** Aggregate grant documents inside the credential's query, preserving its round-trip count. */
export const grantCanArray: Fragment = Object.freeze({
  fragment: (dialect: Dialect) =>
    dialect.name === "sqlite" ? "json_group_array(g.can)" : "CAST(json_agg(g.can) AS TEXT)",
});

export function connectionGrantCans(value: unknown): CanInput[] {
  const documents = value == null ? [] : (JSON.parse(String(value)) as string[]);
  return documents.map((document) => JSON.parse(document) as CanInput);
}

const lockIssuerQuota: Fragment = Object.freeze({
  fragment: ({ name }: Dialect) =>
    name === "postgres"
      ? "pg_advisory_xact_lock(hashtextextended('openboard oidc issuer quota:' || CAST(scope.org_id AS TEXT), 0))"
      : "scope.org_id",
});
const issuerJson: Fragment = Object.freeze({
  fragment: ({ name }: Dialect) =>
    name === "postgres" ? "CAST(p.detail AS JSON) ->> 'issuer'" : "p.detail ->> 'issuer'",
});

export const grantStatements = {
  lockGrantIssuerQuota: sql`SELECT ${lockIssuerQuota} FROM (SELECT CAST(${"orgId"} AS BIGINT) AS org_id) scope
    WHERE scope.org_id = ${"orgId"}`,
  otherGrantIssuers: sql`SELECT DISTINCT ${issuerJson} AS issuer
    FROM grant_principals p JOIN grants g ON g.board_id = p.board_id AND g.id = p.grant_id
    JOIN boards b ON b.org_id = g.org_id AND b.id = g.board_id
    WHERE g.org_id = ${"orgId"} AND b.deleted_at IS NULL AND g.revoked = 0 AND p.kind = 'oidc'
      AND NOT (g.board_id = ${"boardId"} AND g.id = ${"replacing"})`,
  nextGrant: sql`SELECT next_grant FROM boards WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
  setNextGrant: sql`UPDATE boards SET next_grant = ${"nextGrant"} WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
  insertGrant: sql`INSERT INTO grants (org_id, board_id, id, principals, can, capped, by, at)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"principals"}, ${"can"}, 0, ${"by"}, ${"at"})`,
  updateGrant: sql`INSERT INTO grants (org_id, board_id, id, principals, can, capped, by, at)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"principals"}, ${"can"}, ${"capped"}, ${"by"}, ${"at"})
    ON CONFLICT (board_id, id) DO UPDATE SET principals = excluded.principals, can = excluded.can,
      by = excluded.by, at = excluded.at
    WHERE grants.org_id = ${"orgId"} AND grants.board_id = ${"boardId"} AND grants.revoked = 0`,
  // Legacy connections infer their original grant from the index until an edit can change that answer.
  pinConnectionGrant: sql`UPDATE connections SET origin_grant = (
      SELECT MIN(p.grant_id) FROM grant_principals p
      WHERE p.board_id = ${"boardId"} AND p.kind = 'connection' AND p.key = connections.id)
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND origin_grant IS NULL
      AND (id = ${"connection"} OR id IN (SELECT p.key FROM grant_principals p
        WHERE p.board_id = ${"boardId"} AND p.grant_id = ${"grantId"} AND p.kind = 'connection'))`,
  deleteGrantPrincipals: sql`DELETE FROM grant_principals WHERE board_id = ${"boardId"} AND grant_id = ${"grantId"}`,
  insertGrantPrincipal: sql`INSERT INTO grant_principals (org_id, board_id, grant_id, kind, key, detail)
    VALUES (${"orgId"}, ${"boardId"}, ${"grantId"}, ${"kind"}, ${"key"}, ${"detail"})`,
  personGrants: sql`SELECT DISTINCT g.id, g.can, g.capped
    FROM grant_principals p JOIN grants g ON g.board_id = p.board_id AND g.id = p.grant_id
    JOIN boards b ON b.id = g.board_id AND b.org_id = g.org_id
    JOIN memberships m ON m.org_id = b.org_id JOIN users u ON u.id = m.user_id
    LEFT JOIN identities i ON i.user_id = u.id AND i.provider = 'github'
    WHERE p.board_id = ${"boardId"} AND g.org_id = ${"orgId"} AND g.revoked = 0
      AND u.public_id = ${"personId"} AND u.disabled_at IS NULL
      AND ((p.kind = 'user' AND p.key = u.public_id)
        OR (p.kind = 'all-users' AND p.key = '')
        OR (p.kind = 'github' AND p.key = i.subject))
    UNION ALL
    SELECT 1, '{"*":"all"}', 1 FROM boards b
    JOIN memberships m ON m.org_id = b.org_id JOIN users u ON u.id = m.user_id
    WHERE b.org_id = ${"orgId"} AND b.id = ${"boardId"}
      AND u.public_id = ${"personId"} AND u.disabled_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM grants WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = 1)`,
  activeGrant: sql`SELECT id, principals, can, capped, by, at, revoked FROM grants
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  revokeGrant: sql`UPDATE grants SET revoked = 1
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"} AND revoked = 0`,
  revokeStartingGrant: sql`INSERT INTO grants (org_id, board_id, id, principals, can, capped, revoked)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, '[]', '{}', 0, 1) ON CONFLICT (board_id, id) DO UPDATE SET revoked = 1
    WHERE grants.org_id = ${"orgId"} AND grants.board_id = ${"boardId"} AND grants.revoked = 0`,
  listGrants: sql`SELECT id, principals, can, capped, by, at, revoked FROM grants
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND (revoked = 0 OR id <= 3) ORDER BY id`,
};

/**
 * The grants every board starts with, as upstream's `STARTING_GRANTS`. A stored row replaces the starting grant.
 * g1 names every member of the organization, capped by role (docs/auth.md); g2 and g3 are kept for upstream parity
 * and let no one in, since OpenBoard has no projects or apps.
 */
const STARTING_GRANTS: readonly GrantView[] = Object.freeze([
  { id: "g1", principals: [{ kind: "all-users" }], can: { "*": "all" }, capped: true, by: null, at: null },
  {
    id: "g2",
    principals: [{ kind: "all-projects", environments: ["production", "preview", "development"] }],
    can: { "*": ["read", "post", "react", "label", "sync"] },
    capped: false,
    by: null,
    at: null,
  },
  {
    id: "g3",
    principals: [{ kind: "all-apps" }],
    can: { "*": ["read", "post", "react", "label"] },
    capped: false,
    by: null,
    at: null,
  },
]);

function grantView(row: Record<string, unknown>): GrantView {
  return {
    id: grants.formatGrantId(Number(row.id)),
    principals: JSON.parse(String(row.principals)) as GrantPrincipal[],
    can: JSON.parse(String(row.can)) as CanInput,
    capped: Number(row.capped) === 1,
    by: row.by == null ? null : String(row.by),
    at: row.at == null ? null : isoTime(Number(row.at)),
  };
}

export function grantReads(db: Db, dialect: Dialect, keys: BoardKeys): BoardGrantReads {
  return {
    async personGrants(personId) {
      const rows = await query(db, dialect, grantStatements.personGrants, { ...keys, personId });
      return rows.map(({ can, capped }) => ({
        can: JSON.parse(String(can)) as CanInput,
        capped: Number(capped) === 1,
      }));
    },
    async listGrants() {
      const rows = await query(db, dialect, grantStatements.listGrants, keys);
      const stored = new Set(rows.map(({ id }) => Number(id)));
      const starting = STARTING_GRANTS.filter((_, index) => !stored.has(index + 1));
      return [...structuredClone(starting), ...rows.filter(({ revoked }) => Number(revoked) === 0).map(grantView)].sort(
        (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)),
      );
    },
  };
}

/** Unmatched principals keep their full detail, with a fixed-size key below PostgreSQL's index-entry limit. */
function principalKey(principal: GrantPrincipal, position: number): string {
  switch (principal.kind) {
    case "connection":
      return principal.connection;
    case "user":
      return principal.userId;
    case "all-users":
    case "all-connections":
    case "all-apps":
    case "everyone":
      return "";
    case "github":
      if (principal.workflow === undefined && principal.branch === undefined && principal.event === undefined) {
        return principal.repository;
      }
      break;
  }
  return `detail:${position}`;
}

export async function activeGrant(db: Db, dialect: Dialect, keys: BoardKeys, id: number): Promise<GrantView | null> {
  const [row] = await query(db, dialect, grantStatements.activeGrant, { ...keys, id });
  if (row) return Number(row.revoked) === 0 ? grantView(row) : null;
  return structuredClone(STARTING_GRANTS[id - 1] ?? null);
}

export async function foldGrantEvent(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  event: GrantCreated | GrantRevoked | GrantUpdated,
) {
  if (event.type === "ob.grant.revoked") {
    const id = Number(event.payload.grant.slice(1));
    const statement = id <= STARTING_GRANTS.length ? grantStatements.revokeStartingGrant : grantStatements.revokeGrant;
    await query(tx, dialect, statement, { ...keys, id });
    return;
  }
  await foldGrantWritten(tx, dialect, keys, event);
}

async function foldGrantWritten(tx: Db, dialect: Dialect, keys: BoardKeys, event: GrantCreated | GrantUpdated) {
  const { grant } = event.payload;
  const id = Number(grant.id.slice(1));
  const updated = event.type === "ob.grant.updated";
  const statement = updated ? grantStatements.updateGrant : grantStatements.insertGrant;
  await query(tx, dialect, statement, {
    ...keys,
    id,
    principals: JSON.stringify(grant.principals),
    can: JSON.stringify(grant.can),
    capped: grant.capped ? 1 : 0,
    by: event.actor,
    at: event.at,
  });
  if (updated) {
    await query(tx, dialect, grantStatements.pinConnectionGrant, { ...keys, grantId: id, connection: null });
    for (const named of grant.principals) {
      if (named.kind === "connection") {
        await query(tx, dialect, grantStatements.pinConnectionGrant, {
          ...keys,
          grantId: id,
          connection: named.connection,
        });
      }
    }
    await query(tx, dialect, grantStatements.deleteGrantPrincipals, { ...keys, grantId: id });
  }
  await indexGrantPrincipals(tx, dialect, keys, id, grant.principals);
  if (!updated) await query(tx, dialect, grantStatements.setNextGrant, { ...keys, nextGrant: id + 1 });
}

async function indexGrantPrincipals(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  id: number,
  principals: GrantPrincipal[],
) {
  const stored = new Set<string>();
  for (const [position, principal] of principals.entries()) {
    const detail = JSON.stringify(principal);
    const key = principalKey(principal, position);
    const indexKey = JSON.stringify([principal.kind, key]);
    if (stored.has(indexKey)) continue;
    stored.add(indexKey);
    await query(tx, dialect, grantStatements.insertGrantPrincipal, {
      ...keys,
      grantId: id,
      kind: principal.kind,
      key,
      detail,
    });
  }
}

export async function otherGrantIssuers(tx: Db, dialect: Dialect, keys: BoardKeys, replacing: number) {
  // The advisory lock serializes issuer additions without upgrading the board writer's shared organization row lock.
  if (dialect.name === "postgres") await query(tx, dialect, grantStatements.lockGrantIssuerQuota, keys);
  const rows = await query(tx, dialect, grantStatements.otherGrantIssuers, { ...keys, replacing });
  return rows.map(({ issuer }) => String(issuer));
}
