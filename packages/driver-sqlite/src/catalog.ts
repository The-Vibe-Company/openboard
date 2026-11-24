import { Database } from "bun:sqlite";
import { migrations } from "@openboard/driver-sql";
import { migrate } from "./migrate.ts";

/** One table as the schema-parity test compares it: columns by name with nullability, and the primary key in order. */
export type CatalogTable = {
  readonly name: string;
  readonly columns: readonly { readonly name: string; readonly notNull: boolean }[];
  readonly primaryKey: readonly string[];
};

/** What a migrated database holds: its tables sorted by name, and the migration versions it recorded. */
export type Catalog = { readonly tables: readonly CatalogTable[]; readonly versions: readonly number[] };

type ColumnRow = { name: string; notnull: number; pk: number; type: string };

/**
 * Migrates a fresh in-memory database and reads its catalog with `pragma_table_list` and `pragma_table_info`
 * (docs/data-model.md "The store port", point 3). A primary-key column counts as not null where SQLite enforces
 * it, as Postgres always does: in a `WITHOUT ROWID` table, and as the `INTEGER PRIMARY KEY` row ID alias.
 */
export function sqliteCatalog(now = 0): Catalog {
  const database = new Database(":memory:", { strict: true });
  try {
    migrate(database, migrations, now);
    const tables = database
      .query<{ name: string; wr: number }, []>(
        "SELECT name, wr FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
      )
      .all();
    const info = database.query<ColumnRow, [string]>('SELECT name, "notnull", pk, type FROM pragma_table_info(?)');
    const versions = database
      .query<{ version: number }, []>("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => row.version);
    return { tables: tables.map((table) => describe(table.name, table.wr === 1, info.all(table.name))), versions };
  } finally {
    database.close();
  }
}

function describe(name: string, withoutRowid: boolean, rows: readonly ColumnRow[]): CatalogTable {
  const key = rows.filter((row) => row.pk > 0).sort((a, b) => a.pk - b.pk);
  const rowidAlias = !withoutRowid && key.length === 1 && key[0]?.type.toUpperCase() === "INTEGER";
  const columns = rows
    .map((row) => ({ name: row.name, notNull: row.notnull === 1 || (row.pk > 0 && (withoutRowid || rowidAlias)) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { name, columns, primaryKey: key.map((row) => row.name) };
}
