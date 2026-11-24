import type { PlatformView } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { query, sql } from "../../sql.ts";

const CLOCK_SKEW_MS = 60_000;

export const rateStatements = {
  pruneRates: sql`DELETE FROM rate_counters WHERE expires_at <= ${"through"}`,
  takeRate: sql`
    INSERT INTO rate_counters (key, window_start, n, expires_at)
    VALUES (${"key"}, ${"windowStart"}, 1, ${"expiresAt"})
    ON CONFLICT (key, window_start) DO UPDATE SET n = rate_counters.n + 1
    WHERE rate_counters.n < ${"limit"}
    RETURNING n`,
};

/** The upsert serializes competing debits, including requests from different instances. */
export function rateView(db: Db, dialect: Dialect): Pick<PlatformView, "takeRate"> {
  return {
    async takeRate(key, limit, windowMs, now) {
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const expiresAt = windowStart + windowMs;
      const [row] = await query(db, dialect, rateStatements.takeRate, { key, windowStart, expiresAt, limit });
      if (!row) return Math.ceil((expiresAt - now) / 1000);
      // The first debit of a window drives cleanup. Keep a grace period for lagging replica clocks.
      if (Number(row.n) === 1) await query(db, dialect, rateStatements.pruneRates, { through: now - CLOCK_SKEW_MS });
      return undefined;
    },
  };
}
