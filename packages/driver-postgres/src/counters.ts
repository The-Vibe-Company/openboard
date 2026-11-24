/**
 * Counts the statements one Postgres store sends, transaction control included (`BEGIN`, `COMMIT`, `ROLLBACK`), as
 * the SQLite driver's counter does; migrating is not counted. The bench and tests read it before and after one
 * request to learn the statements that operation costs.
 */
export interface StatementCounter {
  /** Statements sent since the counter was created. */
  readonly statements: number;
  /** Records one statement; only the driver calls this. */
  count(): void;
}

/** A counter at zero, to hand to `postgresDriver`. */
export function statementCounter(): StatementCounter {
  let statements = 0;
  return {
    get statements() {
      return statements;
    },
    count() {
      statements += 1;
    },
  };
}
