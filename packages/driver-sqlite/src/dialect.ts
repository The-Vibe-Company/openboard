import type { Dialect } from "@openboard/driver-sql";

/**
 * SQLite's side of the shared SQL: `?` placeholders; the board lock is the write mutex, so no row lock; one file has no
 * failover, so its timeline is the constant `0` and a write never advances the head (D37).
 */
export const sqliteDialect: Dialect = Object.freeze({
  name: "sqlite",
  placeholder: () => "?",
  lockSuffix: "",
  notifyHeadSuffix: "",
  serverTimeline: "0",
});
