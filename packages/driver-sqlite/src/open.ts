import { Database, SQLiteError, type SQLQueryBindings } from "bun:sqlite";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { BoardError } from "@openboard/contract";
import { createViews, type Db, migrations, type Row, type SqlValue, withWebhookMetrics } from "@openboard/driver-sql";
import type { Store, StoreMetrics } from "@openboard/ports";
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

function unavailable(error: unknown): never {
  // The low byte of an extended SQLite result code identifies its primary failure.
  const retryable = [5, 6, 10, 13, 14]; // BUSY, LOCKED, IOERR, FULL, CANTOPEN
  if (error instanceof SQLiteError && retryable.includes(error.errno & 0xff)) {
    throw new BoardError("unavailable", "The board's storage is unavailable; try again.");
  }
  throw error;
}

/**
 * One connection, and one queue in front of it: a write transaction holds the queue from `BEGIN IMMEDIATE` to
 * `COMMIT`, so no other statement interleaves with it between awaits (the process write mutex of D33).
 */
function connection(
  database: Database,
  counter: StatementCounter | undefined,
  boardLockObserver: () => ((ms: number) => void) | undefined,
): Db {
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task).catch(unavailable);
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
    transaction: (fn) => {
      const observe = boardLockObserver();
      const started = observe ? performance.now() : 0;
      return exclusive(async () => {
        control("BEGIN IMMEDIATE");
        const wait = observe ? performance.now() - started : 0;
        const tx: Db = observe
          ? {
              ...inTransaction,
              measureBoardLock(work) {
                observe(wait);
                return work();
              },
            }
          : inTransaction;
        try {
          const result = await fn(tx);
          control("COMMIT");
          return result;
        } catch (error) {
          if (database.inTransaction) control("ROLLBACK");
          throw error;
        }
      });
    },
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
  let metrics: StoreMetrics | undefined;
  const db = withWebhookMetrics(
    connection(database, counter, () => metrics?.boardLock),
    () => metrics,
  );
  const jobs = sqliteJobs(db, now);
  return {
    jobs,
    observeMetrics(observer) {
      metrics = observer;
    },
    ...createViews(db, sqliteDialect, sqliteBroadcaster(), { now, committed: jobs.committed }),
    async close() {
      jobs.close();
      await stopSnapshots?.();
      database.close();
    },
  };
}
