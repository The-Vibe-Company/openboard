import type { SQL } from "bun";
import type { Db, Row } from "@openboard/driver-sql";

/** Runs the shared registry's positional queries on the pool or its reserved transaction connection. */
export function connection(sql: SQL): Db {
  return {
    query: async (text, values) => sql.unsafe<Row[]>(text, [...values]),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const result = await sql.begin(async (session) => {
        const tx: Db = {
          query: async (text, values) => session.unsafe<Row[]>(text, [...values]),
          transaction: () => Promise.reject(new Error("a board write does not nest")),
        };
        return { value: await fn(tx) };
      });
      return result.value;
    },
  };
}
