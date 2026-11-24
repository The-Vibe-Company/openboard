/**
 * Counts statements and round trips for one Postgres store, including transaction control and excluding migrations.
 */
export interface StatementCounter {
  /** Statements sent since the counter was created. */
  readonly statements: number;
  /** Round trips since the counter was created. */
  readonly roundTrips: number;
  /** Records one statement and whether it starts a new round trip. */
  count(roundTrip: boolean): void;
}

/** A counter at zero, to hand to `postgresDriver`. */
export function statementCounter(): StatementCounter {
  let statements = 0;
  let roundTrips = 0;
  return {
    get statements() {
      return statements;
    },
    get roundTrips() {
      return roundTrips;
    },
    count(roundTrip) {
      statements += 1;
      if (roundTrip) roundTrips += 1;
    },
  };
}
