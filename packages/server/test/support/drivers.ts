import { createTestDatabases } from "@openboard/driver-postgres";
import { type Catalog, postgresCatalog } from "@openboard/driver-postgres/catalog";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { sqliteCatalog } from "@openboard/driver-sqlite/catalog";
import type { Store } from "@openboard/ports";

export type { Catalog };

/** The store HTTP tests run on: in-memory SQLite. Postgres with two instances arrives with the Postgres driver. */
export function openStore(now: () => number): Store {
  return sqliteDriver({ memory: true }, now);
}

/** Both engines' catalogs after every migration: a fresh in-memory SQLite and a fresh database on the Postgres at `url`. */
export async function engineCatalogs(url: string): Promise<{ readonly sqlite: Catalog; readonly postgres: Catalog }> {
  const databases = await createTestDatabases(url);
  try {
    const database = await databases.create();
    try {
      return { sqlite: sqliteCatalog(), postgres: await postgresCatalog({ url: database.url }) };
    } finally {
      await database.drop();
    }
  } finally {
    await databases.close();
  }
}
