import type { SQL } from "bun";
import { migrations, splitStatements } from "@openboard/driver-sql";
import { buildIndex, concurrentIndexes } from "./concurrent-indexes.ts";

async function applied(sql: SQL, version: number): Promise<boolean> {
  const rows = await sql`SELECT version FROM schema_migrations WHERE version = ${version}`;
  return rows.length > 0;
}

async function record(sql: SQL, version: number, now: number): Promise<void> {
  await sql`INSERT INTO schema_migrations (version, applied_at) VALUES (${version}, ${now})`;
}

/** Applies the shared Postgres DDL in order, preserving concurrent index builds (D55). */
export async function migrate(sql: SQL, now: number): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)`;
  for (const { version, sql: ddl } of migrations) {
    const indexes = concurrentIndexes(splitStatements(ddl));
    if (indexes) {
      if (await applied(sql, version)) continue;
      for (const index of indexes) {
        await buildIndex(sql, index);
      }
      await record(sql, version, now);
    } else {
      await sql.begin(async (tx) => {
        if (await applied(tx, version)) return;
        await tx.unsafe(ddl).simple();
        await record(tx, version, now);
      });
    }
  }
}
