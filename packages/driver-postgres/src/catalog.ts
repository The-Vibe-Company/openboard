import { SQL } from "bun";
import { migrateLocked } from "./migrate.ts";

/** One table as the schema-parity test compares it: columns by name with nullability, and the primary key in order. */
export type CatalogTable = {
  readonly name: string;
  readonly columns: readonly { readonly name: string; readonly notNull: boolean }[];
  readonly primaryKey: readonly string[];
};

/** What a migrated database holds: its tables sorted by name, and the migration versions it recorded. */
export type Catalog = { readonly tables: readonly CatalogTable[]; readonly versions: readonly number[] };

/**
 * Migrates the database at `url` under the migration lock, then reads its catalog from `information_schema`: the
 * base tables and columns of the current schema, and their primary-key constraints (docs/data-model.md
 * "The store port", point 3).
 */
export async function postgresCatalog(options: { readonly url: string }, now = 0): Promise<Catalog> {
  const sql = new SQL(options.url);
  try {
    await migrateLocked(sql, now);
    const columns = await sql<{ table_name: string; column_name: string; is_nullable: string }[]>`
      SELECT c.table_name, c.column_name, c.is_nullable
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name COLLATE "C", c.column_name COLLATE "C"
    `;
    const keys = await sql<{ table_name: string; column_name: string }[]>`
      SELECT k.table_name, k.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage k
        ON k.constraint_schema = tc.constraint_schema AND k.constraint_name = tc.constraint_name
        AND k.table_name = tc.table_name
      WHERE tc.table_schema = current_schema() AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY k.table_name, k.ordinal_position
    `;
    const versions = await sql<{ version: number }[]>`SELECT version FROM schema_migrations ORDER BY version`;
    const tables = new Map<
      string,
      { name: string; columns: { name: string; notNull: boolean }[]; primaryKey: string[] }
    >();
    for (const row of columns) {
      const table = tables.get(row.table_name) ?? { name: row.table_name, columns: [], primaryKey: [] };
      table.columns.push({ name: row.column_name, notNull: row.is_nullable === "NO" });
      tables.set(row.table_name, table);
    }
    for (const row of keys) tables.get(row.table_name)?.primaryKey.push(row.column_name);
    return { tables: [...tables.values()], versions: versions.map((row) => row.version) };
  } finally {
    await sql.close();
  }
}
