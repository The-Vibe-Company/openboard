import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  type Db,
  migrations,
  type Row,
  seedSweep,
  seedTaskNeed,
  simulateLegacyDeletion,
  sweepSnapshot,
  tenantRows,
} from "@openboard/driver-sql";
import type { BoardKeys } from "@openboard/ports";
import { sqliteDialect } from "./dialect.ts";
import { migrate } from "./migrate.ts";
import { sqliteDriver } from "./open.ts";

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
    return readCatalog(database);
  } finally {
    database.close();
  }
}

function readCatalog(database: Database): Catalog {
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
}

function describe(name: string, withoutRowid: boolean, rows: readonly ColumnRow[]): CatalogTable {
  const key = rows.filter((row) => row.pk > 0).sort((a, b) => a.pk - b.pk);
  const rowidAlias = !withoutRowid && key.length === 1 && key[0]?.type.toUpperCase() === "INTEGER";
  const columns = rows
    .map((row) => ({ name: row.name, notNull: row.notnull === 1 || (row.pk > 0 && (withoutRowid || rowidAlias)) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { name, columns, primaryKey: key.map((row) => row.name) };
}

async function withTestDb<T>(file: string, work: (db: Db, database: Database) => Promise<T>): Promise<T> {
  const database = new Database(file);
  try {
    const db: Db = {
      query: async (text, values) => database.query<Row, SQLQueryBindings[]>(text).all(...values),
      transaction: () => Promise.reject(new Error("fixture queries do not use transactions")),
    };
    return await work(db, database);
  } finally {
    database.close();
  }
}

/** A file-backed SQLite fixture so a separate read connection can inspect the persisted rows. */
export function sqlitePurgeFixture(now: () => number) {
  const dir = mkdtempSync("openboard-purge-");
  try {
    const store = sqliteDriver({ dir, scheduleSnapshot: () => () => {} }, now);
    const file = join(dir, "board.db");
    let closing: Promise<void> | undefined;
    return {
      ...store,
      tenantRows: ({ orgId, boardId }: BoardKeys, extraBoards: readonly number[] = []) =>
        withTestDb(file, (db, database) =>
          tenantRows(db, "?", readCatalog(database).tables, orgId, [boardId, ...extraBoards]),
        ),
      seedSweep: (keys: BoardKeys, webhook: string, at: number) =>
        withTestDb(file, (db) => seedSweep(db, sqliteDialect, keys, webhook, at)),
      sweepSnapshot: () => withTestDb(file, sweepSnapshot),
      seedTaskNeed: (keys: BoardKeys, task: number, needs: number) =>
        withTestDb(file, (db) => seedTaskNeed(db, sqliteDialect, keys, task, needs)),
      simulateLegacyDeletion: (orgId: number) =>
        withTestDb(file, (db) => simulateLegacyDeletion(db, sqliteDialect, orgId)),
      close: () => {
        closing ??= store.close().finally(() => rmSync(dir, { recursive: true, force: true }));
        return closing;
      },
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
