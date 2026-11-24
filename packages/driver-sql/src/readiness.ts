import type { Db, Dialect } from "./db.ts";
import { query, sql } from "./sql.ts";

export const readinessStatements = Object.freeze({
  schemaVersion: sql`SELECT MAX(version) AS version FROM schema_migrations`,
});

export async function checkSchema(db: Db, dialect: Dialect, required: number): Promise<boolean> {
  const [row] = await query(db, dialect, readinessStatements.schemaVersion, {});
  return typeof row?.version === "number" && row.version >= required;
}
