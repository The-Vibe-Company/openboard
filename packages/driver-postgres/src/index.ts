import { SQL } from "bun";
import { createViews, postgresText } from "@openboard/driver-sql";
import type { Store } from "@openboard/ports";
import { migrate } from "./migrate.ts";
import { connection } from "./pool.ts";

export { createTestDatabases } from "./database.ts";

/** Hosted mode's store, migrated before the server accepts requests. */
export async function postgresDriver(options: { readonly url: string }, now: () => number = Date.now): Promise<Store> {
  const sql = new SQL(options.url);
  try {
    await migrate(sql, now());
    return {
      ...createViews(connection(sql), postgresText),
      close: () => sql.close(),
    };
  } catch (error) {
    await sql.close();
    throw error;
  }
}
