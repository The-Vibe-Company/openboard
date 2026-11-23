import type { Db, Dialect, Row, SqlValue } from "./db.ts";

/** A piece of statement text that differs per dialect. */
export interface Fragment {
  readonly fragment: (dialect: Dialect) => string;
}

/** One statement, written once: its text with named parameters, rendered per dialect. */
export interface Statement<K extends string> {
  readonly strings: readonly string[];
  readonly slots: readonly (K | Fragment)[];
}

/**
 * The tagged template every shared statement is written with. Each `${"name"}` is a named parameter, rendered as
 * `$n` for Postgres and `?` for SQLite; a `Fragment` is dialect text. `query` binds the names, so a statement is
 * text that can be registered, scope-checked and `EXPLAIN`ed without values.
 */
export function sql<K extends string = never>(strings: TemplateStringsArray, ...slots: (K | Fragment)[]): Statement<K> {
  return Object.freeze({ strings: [...strings], slots });
}

/** ` FOR UPDATE` where the engine locks rows. */
export const forUpdate: Fragment = Object.freeze({ fragment: (dialect: Dialect) => dialect.lockSuffix });

/** The statement's text in `dialect`, and the parameter names in placeholder order. */
export function render<K extends string>(statement: Statement<K>, dialect: Dialect): { text: string; names: K[] } {
  const names: K[] = [];
  const pieces = [statement.strings[0] ?? ""];
  statement.slots.forEach((slot, at) => {
    if (typeof slot === "string") {
      names.push(slot);
      pieces.push(dialect.placeholder(names.length));
    } else {
      pieces.push(slot.fragment(dialect));
    }
    pieces.push(statement.strings[at + 1] ?? "");
  });
  return { text: pieces.join(""), names };
}

/** Runs `statement` on `db` with its named parameters bound. */
export function query<K extends string>(
  db: Db,
  dialect: Dialect,
  statement: Statement<K>,
  params: Readonly<Record<K, SqlValue>>,
): Promise<Row[]> {
  const { text, names } = render(statement, dialect);
  return db.query(
    text,
    names.map((name) => params[name]),
  );
}
