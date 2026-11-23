import { Database, type SQLQueryBindings } from "bun:sqlite";
import { createViews, type Db, migrations, type Row, type SqlValue } from "@openboard/driver-sql";
import type { Store } from "@openboard/ports";
import { sqliteDialect } from "./dialect.ts";
import { migrate } from "./migrate.ts";

/** Where the database lives. A data directory that survives a restart is a later step; memory serves tests and dev. */
export type SqliteOptions = { readonly memory: true };

const PRAGMAS = [
  "journal_mode = WAL",
  "synchronous = NORMAL",
  "foreign_keys = OFF",
  "temp_store = MEMORY",
  "cache_size = -16000",
  "busy_timeout = 5000",
];

/**
 * One connection, and one queue in front of it: a write transaction holds the queue from `BEGIN IMMEDIATE` to
 * `COMMIT`, so no other statement interleaves with it between awaits (the process write mutex of D33).
 */
function connection(database: Database): Db {
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
  const run = async (text: string, values: readonly SqlValue[]) =>
    database.query<Row, SQLQueryBindings[]>(text).all(...(values as SQLQueryBindings[]));
  const inTransaction: Db = {
    query: run,
    transaction: () => Promise.reject(new Error("a board write does not nest")),
  };
  return {
    query: (text, values) => exclusive(() => run(text, values)),
    transaction: (fn) =>
      exclusive(async () => {
        database.run("BEGIN IMMEDIATE");
        try {
          const result = await fn(inTransaction);
          database.run("COMMIT");
          return result;
        } catch (error) {
          database.run("ROLLBACK");
          throw error;
        }
      }),
  };
}

/** Local mode's store on SQLite: migrated on open, with the implicit organization `local` and board `main`. */
export function sqliteDriver(_options: SqliteOptions, now: () => number = Date.now): Store {
  const database = new Database(":memory:", { strict: true });
  for (const pragma of PRAGMAS) database.run(`PRAGMA ${pragma}`);
  migrate(database, migrations, now());
  return {
    ...createViews(connection(database), sqliteDialect),
    async close() {
      database.close();
    },
  };
}
