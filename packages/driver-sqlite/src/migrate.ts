import type { Database } from "bun:sqlite";
import type { Migration } from "@openboard/driver-sql";
import { renderDdl } from "./ddl.ts";

/** Applies every migration the database has not recorded, each in its own transaction, in order. */
export function migrate(database: Database, migrations: readonly Migration[], now: number): void {
  database.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT",
  );
  const applied = new Set(
    database
      .query<{ version: number }, []>("SELECT version FROM schema_migrations")
      .all()
      .map((row) => row.version),
  );
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    database.transaction(() => {
      database.run(renderDdl(migration.sql));
      database.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [migration.version, now]);
    })();
  }
}
