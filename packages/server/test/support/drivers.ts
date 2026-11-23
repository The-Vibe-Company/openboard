import { sqliteDriver } from "@openboard/driver-sqlite";
import type { Store } from "@openboard/ports";

/** The store HTTP tests run on: in-memory SQLite. Postgres with two instances arrives with the Postgres driver. */
export function openStore(now: () => number): Store {
  return sqliteDriver({ memory: true }, now);
}
