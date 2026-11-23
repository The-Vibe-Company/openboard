/** A value a statement binds or a row holds; JSON is `TEXT`, booleans `0`/`1`, times milliseconds (data-model "DDL"). */
export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Readonly<Record<string, SqlValue>>;

/** The engine-neutral connection the shared views run on; each driver implements it over its own client. */
export interface Db {
  /** Runs one statement with positional values and returns its rows (none for a write without `RETURNING`). */
  query(text: string, values: readonly SqlValue[]): Promise<Row[]>;
  /**
   * Runs `fn` in one transaction that commits when it resolves and rolls back when it throws. Writes are serialized:
   * SQLite takes the process write mutex and `BEGIN IMMEDIATE`; Postgres locks the board row in the first statement.
   */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

/** What differs between the engines in the shared SQL text (docs/data-model.md "The store port"). */
export interface Dialect {
  readonly name: "sqlite" | "postgres";
  /** The placeholder of the `index`-th value, from 1: `$1` or `?`. */
  placeholder(index: number): string;
  /** Ends the head read that opens a board write: ` FOR UPDATE` on Postgres, nothing on SQLite. */
  readonly lockSuffix: string;
}

/** The dialect the registry is written in, and the one Postgres runs. */
export const postgresText: Dialect = Object.freeze({
  name: "postgres",
  placeholder: (index: number) => `$${index}`,
  lockSuffix: " FOR UPDATE",
});
