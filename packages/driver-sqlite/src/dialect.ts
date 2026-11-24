import type { Dialect } from "@openboard/driver-sql";

/** SQLite's side of the shared SQL: `?` placeholders; the board lock is the write mutex, so no row lock. */
export const sqliteDialect: Dialect = Object.freeze({
  name: "sqlite",
  placeholder: () => "?",
  lockSuffix: "",
  notifyHeadSuffix: "",
});
