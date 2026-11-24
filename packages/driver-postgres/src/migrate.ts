import type { SQL } from "bun";
import { migrations, splitStatements } from "@openboard/driver-sql";
import { buildIndex, concurrentIndexes } from "./concurrent-indexes.ts";

/**
 * The `pg_advisory_lock` key every migrator takes (docs/architecture.md "Migrations without downtime", D36):
 * the bytes of "openboar" read as a signed 64-bit integer, so no other application's key collides by accident.
 */
export const MIGRATION_LOCK = 0x6f70656e626f6172n;

/** How long one lock attempt waits before it retries in a new statement (see `lockFor`). */
const LOCK_ATTEMPT = "100ms";

async function applied(sql: SQL, version: number): Promise<boolean> {
  const rows = await sql`SELECT version FROM schema_migrations WHERE version = ${version}`;
  return rows.length > 0;
}

async function record(sql: SQL, version: number, now: number): Promise<void> {
  await sql`INSERT INTO schema_migrations (version, applied_at) VALUES (${version}, ${now})`;
}

/** Applies the shared Postgres DDL in order, preserving concurrent index builds (D55); returns the names applied. */
export async function migrate(sql: SQL, now: number, onApplied?: (name: string) => void): Promise<string[]> {
  const done: string[] = [];
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)`;
  for (const { version, name, sql: ddl } of migrations) {
    const indexes = concurrentIndexes(splitStatements(ddl));
    let ran = false;
    if (indexes) {
      if (await applied(sql, version)) continue;
      for (const index of indexes) {
        await buildIndex(sql, index);
      }
      await record(sql, version, now);
      ran = true;
    } else {
      ran = await sql.begin(async (tx) => {
        if (await applied(tx, version)) return false;
        await tx.unsafe(ddl).simple();
        await record(tx, version, now);
        return true;
      });
    }
    if (ran) {
      done.push(name);
      onApplied?.(name);
    }
  }
  return done;
}

/**
 * Takes the migration lock on `session`. A waiting `pg_advisory_lock` statement holds a snapshot, which a
 * concurrent `CREATE INDEX CONCURRENTLY` in the holder's session waits out: a deadlock. Each attempt is therefore
 * bounded by `lock_timeout`, well under `deadlock_timeout`, and retried in a new statement until the lock is free.
 */
async function lockFor(session: SQL): Promise<void> {
  await session`SELECT set_config('lock_timeout', ${LOCK_ATTEMPT}, false)`;
  try {
    for (;;) {
      try {
        await session`SELECT pg_advisory_lock(${MIGRATION_LOCK})`;
        return;
      } catch (error) {
        if ((error as { errno?: unknown }).errno !== "55P03") throw error;
      }
    }
  } finally {
    await session`RESET lock_timeout`;
  }
}

/**
 * Migrates once across every instance: holds the session-level advisory lock on one dedicated connection for the
 * whole run, the one session lock the failover rules allow (docs/architecture.md "Upgrade path to a failover
 * database"). A second migrator waits, then finds the schema current.
 */
export async function migrateLocked(sql: SQL, now: number, onApplied?: (name: string) => void): Promise<string[]> {
  const session = await sql.reserve();
  try {
    await lockFor(session);
    try {
      return await migrate(session, now, onApplied);
    } finally {
      await session`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`;
    }
  } finally {
    await session.release();
  }
}
