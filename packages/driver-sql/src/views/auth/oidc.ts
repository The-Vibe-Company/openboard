import type { PlatformView } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { query, sql } from "../../sql.ts";

export const oidcStatements = {
  oidcReserveReload: sql`INSERT INTO oidc_keys (issuer, retry_at, expires_at)
    VALUES (${"issuer"}, ${"leaseUntil"}, 0)
    ON CONFLICT (issuer) DO UPDATE SET retry_at = excluded.retry_at
    WHERE oidc_keys.retry_at <= ${"now"} RETURNING issuer`,
  oidcReadKeys: sql`SELECT document, expires_at FROM oidc_keys
    WHERE issuer = ${"issuer"} AND expires_at > ${"now"}`,
  oidcFinishReload: sql`UPDATE oidc_keys SET retry_at = ${"retryAt"},
    document = COALESCE(${"document"}, document), expires_at = COALESCE(${"expiresAt"}, expires_at)
    WHERE issuer = ${"issuer"} AND retry_at = ${"leaseUntil"}`,
  oidcPruneKeys: sql`DELETE FROM oidc_keys WHERE issuer <> ${"issuer"}
    AND retry_at <= ${"now"} AND expires_at <= ${"now"}`,
};

export function oidcKeysView(
  db: Db,
  dialect: Dialect,
): Pick<PlatformView, "reserveOidcReload" | "readOidcKeys" | "finishOidcReload"> {
  return {
    async reserveOidcReload(issuer, now, leaseUntil) {
      return (await query(db, dialect, oidcStatements.oidcReserveReload, { issuer, now, leaseUntil })).length > 0;
    },
    async readOidcKeys(issuer, now) {
      const [row] = await query(db, dialect, oidcStatements.oidcReadKeys, { issuer, now });
      return row ? { document: String(row.document), expiresAt: Number(row.expires_at) } : null;
    },
    async finishOidcReload(issuer, leaseUntil, completedAt, retryAt, loaded) {
      await query(db, dialect, oidcStatements.oidcFinishReload, {
        issuer,
        leaseUntil,
        retryAt,
        document: loaded?.document ?? null,
        expiresAt: loaded?.expiresAt ?? null,
      });
      await query(db, dialect, oidcStatements.oidcPruneKeys, { issuer, now: completedAt });
    },
  };
}
