import { Database, type SQLQueryBindings } from "bun:sqlite";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { createViews, type Db, migrations, type Row, type SqlValue } from "@openboard/driver-sql";
import type { Store } from "@openboard/ports";
import { sqliteBroadcaster } from "./broadcaster.ts";
import type { StatementCounter } from "./counters.ts";
import { sqliteDialect } from "./dialect.ts";
import { sqliteJobs } from "./jobs.ts";
import { migrate } from "./migrate.ts";
import { type SnapshotOptions, snapshotBeforeMigration, startSnapshots } from "./snapshot.ts";

export type SqliteOptions =
  | { readonly memory: true }
  | ({ readonly dir: string; readonly sync?: "NORMAL" | "FULL" } & SnapshotOptions);

const PRAGMAS = [
  "foreign_keys = OFF",
  "temp_store = MEMORY",
  "cache_size = -16000",
  "mmap_size = 67108864",
  "journal_size_limit = 67108864",
  "wal_autocheckpoint = 1000",
];

function openDatabase(options: SqliteOptions, now: () => number): Database {
  const file = "dir" in options ? join(options.dir, "board.db") : ":memory:";
  let beforeMigration: ((version: number) => void) | undefined;
  if ("dir" in options) {
    mkdirSync(options.dir, { recursive: true, mode: 0o700 });
    // Create privately without opening an existing file outside SQLite's locking protocol.
    try {
      closeSync(openSync(file, "wx", 0o600));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      beforeMigration = (version) => snapshotBeforeMigration(file, join(options.dir, "backups"), version);
    }
  }

  const database = new Database(file, { readwrite: true, create: false, strict: true });
  try {
    database.run("PRAGMA busy_timeout = 5000");
    database.run("PRAGMA journal_mode = WAL");
    database.run(
      "dir" in options && options.sync === "FULL" ? "PRAGMA synchronous = FULL" : "PRAGMA synchronous = NORMAL",
    );
    for (const pragma of PRAGMAS) database.run(`PRAGMA ${pragma}`);
    migrate(database, migrations, now(), beforeMigration);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

/**
 * One connection, and one queue in front of it: a write transaction holds the queue from `BEGIN IMMEDIATE` to
 * `COMMIT`, so no other statement interleaves with it between awaits (the process write mutex of D33).
 */
function connection(database: Database, counter?: StatementCounter): Db {
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
  const control = (text: string) => {
    counter?.count();
    database.run(text);
  };
  const run = async (text: string, values: readonly SqlValue[]) => {
    counter?.count();
    return database.query<Row, SQLQueryBindings[]>(text).all(...(values as SQLQueryBindings[]));
  };
  const inTransaction: Db = {
    query: run,
    transaction: () => Promise.reject(new Error("a board write does not nest")),
  };
  return {
    query: (text, values) => exclusive(() => run(text, values)),
    transaction: (fn) =>
      exclusive(async () => {
        control("BEGIN IMMEDIATE");
        try {
          const result = await fn(inTransaction);
          control("COMMIT");
          return result;
        } catch (error) {
          control("ROLLBACK");
          throw error;
        }
      }),
  };
}

/**
 * Local mode's store on SQLite: migrated on open, with the implicit organization `local` and board `main`. A
 * `counter`, when given, counts every statement the store sends from then on (tests and bench only).
 */
export function sqliteDriver(options: SqliteOptions, now: () => number = Date.now, counter?: StatementCounter): Store {
  const database = openDatabase(options, now);
  const stopSnapshots =
    "dir" in options ? startSnapshots(database.filename, join(options.dir, "backups"), now, options) : undefined;
  const db = connection(database, counter);
  const jobs = sqliteJobs(db, now);
  return {
    jobs,
    ...createViews(db, sqliteDialect, sqliteBroadcaster(), { now, committed: jobs.committed }),
    async close() {
      jobs.close();
      await stopSnapshots?.();
      database.close();
    },
  };
}
