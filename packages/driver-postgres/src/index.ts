import { SQL } from "bun";
import { createViews, postgresText } from "@openboard/driver-sql";
import type { Store } from "@openboard/ports";
import { migrateLocked } from "./migrate.ts";
import { connection } from "./pool.ts";

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

/** Hosted mode's store, migrated under the migration lock before the server accepts requests. */
export async function postgresDriver(options: { readonly url: string }, now: () => number = Date.now): Promise<Store> {
  const sql = new SQL(options.url);
  try {
    await migrateLocked(sql, now());
    return {
      ...createViews(connection(sql), postgresText),
      close: () => sql.close(),
    };
  } catch (error) {
    await sql.close();
    throw error;
  }
}
