import { createViews, postgresText } from "@openboard/driver-sql";
import type { Store } from "@openboard/ports";
import { SQL } from "bun";
import { postgresBroadcaster } from "./broadcaster.ts";
import { migrateLocked } from "./migrate.ts";
import { connection, openPool } from "./pool.ts";

export { createTestDatabases } from "./database.ts";

/** `openboard migrate`: applies pending migrations under the migration lock; returns the names applied, in order. */
export async function migratePostgres(
  options: { readonly url: string },
  now: () => number = Date.now,
  onApplied?: (name: string) => void,
): Promise<string[]> {
  const sql = new SQL(options.url);
  try {
    return await migrateLocked(sql, now(), onApplied);
  } finally {
    await sql.close();
  }
}

/**
 * Hosted mode's store, migrated under the migration lock before the server accepts requests. Migrations run on their
 * own client, outside the request timeouts, so a long index build is not cut off at 5 s.
 */
export async function postgresDriver(options: { readonly url: string }, now: () => number = Date.now): Promise<Store> {
  await migratePostgres(options, now);
  const sql = openPool(options.url);
  return {
    ...createViews(connection(sql), postgresText, postgresBroadcaster()),
    close: () => sql.close(),
  };
}
