import { SQL } from "bun";
import { BoardError } from "@openboard/contract";
import type { Db, Row } from "@openboard/driver-sql";

/**
 * docs/data-model.md "Postgres settings", sent as startup parameters rather than a session `SET` so every
 * connection the pool opens or reopens carries them (no session-pinned state, docs/architecture.md "Upgrade path").
 */
const SETTINGS = {
  statement_timeout: "5s",
  lock_timeout: "3s",
  idle_in_transaction_session_timeout: "10s",
} as const;

/** Seconds to wait for a connection before a request answers `unavailable` (docs/architecture.md "Availability"). */
const CONNECT_TIMEOUT = 3;

/**
 * Bun's own codes for a connection that could not open or was lost. A backend the server ends under a pending query
 * (`pg_terminate_backend`, a restart) surfaces from Bun's close handler as `ERR_POSTGRES_EXPECTED_REQUEST`.
 */
const LOST = new Set([
  "ERR_POSTGRES_EXPECTED_REQUEST",
  "ERR_POSTGRES_CONNECTION_CLOSED",
  "ERR_POSTGRES_CONNECTION_FAILED",
  "ERR_POSTGRES_CONNECTION_REFUSED",
  "ERR_POSTGRES_CONNECTION_TIMEOUT",
  "ERR_POSTGRES_IDLE_TIMEOUT",
  "ERR_POSTGRES_LIFETIME_TIMEOUT",
]);

/**
 * Server SQLSTATEs that mean "try again": shutdown or startup (57P01-57P03), the three timeouts (statement 57014,
 * lock 55P03, idle in transaction 25P03), and class 08, connection exceptions.
 */
const RETRYABLE = new Set(["57P01", "57P02", "57P03", "57014", "55P03", "25P03"]);

/** The request pool: the settings above on every connection, failing fast when the database cannot be reached. */
export function openPool(url: string): SQL {
  return new SQL(url, { connectionTimeout: CONNECT_TIMEOUT, connection: { ...SETTINGS } });
}

/** True for a lost or unreachable connection and the three timeouts; a constraint violation or bug stays itself. */
export function isUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code, errno } = error as { code?: unknown; errno?: unknown };
  if (typeof code === "string" && LOST.has(code)) return true;
  return typeof errno === "string" && (RETRYABLE.has(errno) || errno.startsWith("08"));
}

/** Answers a database outage as upstream's retryable 503; rethrows everything else unchanged. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isUnavailable(error)) throw error;
    throw new BoardError("unavailable", "The board's storage is unavailable; try again.", {
      hint: "Retry the request; a write that carries an id is safe to repeat.",
    });
  }
}

/** Runs the shared registry's positional queries on the pool or its reserved transaction connection. */
export function connection(sql: SQL): Db {
  return {
    query: (text, values) => guarded(() => sql.unsafe<Row[]>(text, [...values])),
    transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return guarded(async () => {
        const result = await sql.begin(async (session) => {
          const tx: Db = {
            query: async (text, values) => session.unsafe<Row[]>(text, [...values]),
            transaction: () => Promise.reject(new Error("a board write does not nest")),
          };
          return { value: await fn(tx) };
        });
        return result.value;
      });
    },
  };
}
