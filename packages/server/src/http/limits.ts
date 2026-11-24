import { BoardError } from "@openboard/contract";
import type { RateLimits } from "@openboard/ports";

const REFILL_PER_MS = 200;
const CAPACITY = 1_000_000;
const WRITE_COST = 1000;
const REFILL_MS = CAPACITY / REFILL_PER_MS;

export interface RequestLimits {
  readonly rateLimits: RateLimits;
  readonly ip: string | undefined;
}

/** One bucket per organization slug on this instance, in thousandths of a write. */
export function instanceRateLimits(now: () => number): RateLimits {
  const buckets = new Map<string, { remaining: number; at: number }>();
  let sweepAt = 0;
  return {
    takeWrite(org) {
      const at = now();
      if (at >= sweepAt) {
        // A bucket idle for a full refill is equivalent to a fresh bucket.
        for (const [key, bucket] of buckets) {
          if (at - bucket.at >= REFILL_MS) buckets.delete(key);
        }
        sweepAt = at + REFILL_MS;
      }
      const bucket = buckets.get(org) ?? { remaining: CAPACITY, at };
      const through = Math.max(at, bucket.at);
      const remaining = Math.min(CAPACITY, bucket.remaining + (through - bucket.at) * REFILL_PER_MS);
      if (remaining < WRITE_COST) {
        return Math.ceil((through - at + (WRITE_COST - remaining) / REFILL_PER_MS) / 1000);
      }
      buckets.set(org, { remaining: remaining - WRITE_COST, at: through });
      return undefined;
    },
  };
}

export function limitWrite(limits: RateLimits, org: string, readOnly: boolean): void {
  if (readOnly) return;
  const seconds = limits.takeWrite(org);
  if (seconds !== undefined) {
    throw new BoardError("rate_limited", "the organization is writing too quickly", {
      next: [{ kind: "wait", seconds }],
    });
  }
}
