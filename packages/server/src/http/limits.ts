import { BoardError } from "@openboard/contract";
import type { PlatformView, RateLimits } from "@openboard/ports";

import type { ServerConfig } from "../deps.ts";

export interface RequestLimits {
  readonly rateLimits: RateLimits;
  readonly ip: string | undefined;
}

function tokenBuckets(now: () => number, capacity: number, refillPerMs: number, cost: number) {
  const refillMs = capacity / refillPerMs;
  const buckets = new Map<string, { remaining: number; at: number }>();
  let sweepAt = 0;
  return (key: string, consume: boolean, reserved = 0) => {
    const at = now();
    if (at >= sweepAt) {
      // A bucket idle for a full refill is equivalent to a fresh bucket.
      for (const [key, bucket] of buckets) {
        if (at - bucket.at >= refillMs) buckets.delete(key);
      }
      sweepAt = at + refillMs;
    }
    const bucket = buckets.get(key) ?? { remaining: capacity, at };
    const through = Math.max(at, bucket.at);
    const remaining = Math.min(capacity, bucket.remaining + (through - bucket.at) * refillPerMs);
    const needed = cost * (reserved + 1);
    if (remaining < needed) return Math.ceil((through - at + (needed - remaining) / refillPerMs) / 1000);
    if (consume) buckets.set(key, { remaining: remaining - cost, at: through });
    return undefined;
  };
}

export function requestRateLimits(
  now: () => number,
  platform: PlatformView,
  { perPrincipal = 20, perOrganization = 500 }: NonNullable<ServerConfig["streamLimits"]> = {},
  observeStream?: (delta: 1 | -1) => void,
): RateLimits {
  // Integer units: a write costs 1,000, failed authentication 3,000, and refresh 10,000.
  const writes = tokenBuckets(now, 1_000_000, 200, 1_000);
  const failures = tokenBuckets(now, 60_000, 1, 3_000);
  const refreshes = tokenBuckets(now, 60_000, 1, 10_000);
  type Admission = Awaited<ReturnType<RateLimits["admitAuth"]>>;
  type Waiter = (admission: Admission) => void;
  type Pending = { count: number; waiters: Set<Waiter> };
  const pending = new Map<string, Pending>();
  let inbound = 0;
  const inboundByIp = new Map<string, number>();
  const byOrg = new Map<string, number>();
  const byPrincipal = new Map<string, number>();

  function admit(ip: string, active: Pending): Admission | undefined {
    const retryAfter = failures(ip, false);
    if (retryAfter !== undefined) return retryAfter;
    // Each in-flight verification may still fail and holds one available slot.
    if (active.count > 0 && failures(ip, false, active.count) !== undefined) return undefined;
    active.count++;
    return (failed) => {
      if (failed) failures(ip, true);
      active.count--;
      for (const resolve of active.waiters) {
        const next = admit(ip, active);
        if (next === undefined) break;
        active.waiters.delete(resolve);
        resolve(next);
      }
      if (active.count === 0) pending.delete(ip);
    };
  }

  return {
    reserveInbound(ip = "unknown") {
      const fromIp = inboundByIp.get(ip) ?? 0;
      if (inbound >= 20 || fromIp >= 4) return undefined;
      inbound++;
      inboundByIp.set(ip, fromIp + 1);
      return () => {
        inbound--;
        decrement(inboundByIp, ip);
      };
    },
    reserveStream(org, principal) {
      const orgCount = byOrg.get(org) ?? 0;
      const principalCount = byPrincipal.get(principal) ?? 0;
      if (orgCount >= perOrganization || principalCount >= perPrincipal) return undefined;
      byOrg.set(org, orgCount + 1);
      byPrincipal.set(principal, principalCount + 1);
      observeStream?.(1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        observeStream?.(-1);
        decrement(byOrg, org);
        decrement(byPrincipal, principal);
      };
    },
    takeSignIn: (ip) => platform.takeRate(`sign-in:${ip ?? "unknown"}`, 30, 60_000, now()),
    takeRefresh: (agent) => refreshes(agent, true),
    takeWrite: (org) => writes(org, true),
    async admitAuth(ip) {
      const active = pending.get(ip) ?? { count: 0, waiters: new Set<Waiter>() };
      const admission = admit(ip, active);
      if (typeof admission === "number") return admission;
      pending.set(ip, active);
      return admission ?? new Promise<Admission>((resolve) => active.waiters.add(resolve));
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

function decrement(counts: Map<string, number>, key: string): void {
  const count = counts.get(key)!;
  if (count === 1) counts.delete(key);
  else counts.set(key, count - 1);
}

export function limitStream(limits: RateLimits, org: string, principal: string): () => void {
  const release = limits.reserveStream(org, principal);
  if (!release) {
    throw new BoardError("rate_limited", "too many open event streams", {
      next: [{ kind: "wait", seconds: 1 }],
    });
  }
  return release;
}
