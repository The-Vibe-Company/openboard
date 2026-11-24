import type { CanInput, GrantPrincipal, GrantView } from "@openboard/contract";
import { type GrantCreated, grants, isoTime } from "@openboard/core";
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

export const grantStatements = {
  nextGrant: sql`SELECT next_grant FROM boards WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
  setNextGrant: sql`UPDATE boards SET next_grant = ${"nextGrant"} WHERE org_id = ${"orgId"} AND id = ${"boardId"}`,
  insertGrant: sql`INSERT INTO grants (org_id, board_id, id, principals, can, capped, by, at)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"principals"}, ${"can"}, 0, ${"by"}, ${"at"})`,
  insertGrantPrincipal: sql`INSERT INTO grant_principals (board_id, grant_id, kind, key, detail)
    VALUES (${"boardId"}, ${"grantId"}, ${"kind"}, ${"key"}, ${"detail"})`,
  personGrants: sql`SELECT DISTINCT g.id, g.can
    FROM grant_principals p JOIN grants g ON g.board_id = p.board_id AND g.id = p.grant_id
    JOIN boards b ON b.id = g.board_id AND b.org_id = g.org_id
    JOIN memberships m ON m.org_id = b.org_id JOIN users u ON u.id = m.user_id
    LEFT JOIN identities i ON i.user_id = u.id AND i.provider = 'github'
    WHERE p.board_id = ${"boardId"} AND g.org_id = ${"orgId"} AND g.revoked = 0
      AND u.public_id = ${"personId"} AND u.disabled_at IS NULL
      AND ((p.kind = 'user' AND p.key = u.public_id)
        OR (p.kind = 'all-users' AND p.key = '')
        OR (p.kind = 'github' AND p.key = i.subject))`,
  listGrants: sql`SELECT id, principals, can, capped, by, at FROM grants
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND revoked = 0 ORDER BY id`,
};

/**
 * The grants every board starts with, as upstream's `STARTING_GRANTS`: no row holds them, so the view answers them.
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
      return rows.map(({ can }) => JSON.parse(String(can)) as CanInput);
    },
    async listGrants() {
      const rows = await query(db, dialect, grantStatements.listGrants, keys);
      return [...structuredClone(STARTING_GRANTS), ...rows.map(grantView)];
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

export async function foldGrantEvent(tx: Db, dialect: Dialect, keys: BoardKeys, event: GrantCreated) {
  const { grant } = event.payload;
  const id = Number(grant.id.slice(1));
  await query(tx, dialect, grantStatements.insertGrant, {
    ...keys,
    id,
    principals: JSON.stringify(grant.principals),
    can: JSON.stringify(grant.can),
    by: event.actor,
    at: event.at,
  });
  const stored = new Set<string>();
  for (const [position, principal] of grant.principals.entries()) {
    const detail = JSON.stringify(principal);
    const key = principalKey(principal, position);
    const indexKey = JSON.stringify([principal.kind, key]);
    if (stored.has(indexKey)) continue;
    stored.add(indexKey);
    await query(tx, dialect, grantStatements.insertGrantPrincipal, {
      boardId: keys.boardId,
      grantId: id,
      kind: principal.kind,
      key,
      detail,
    });
  }
  await query(tx, dialect, grantStatements.setNextGrant, { ...keys, nextGrant: id + 1 });
}
