import { BoardError } from "@openboard/contract";
import type { PlatformView, RateLimits } from "@openboard/ports";

import type { ServerConfig } from "../deps.ts";
import { type Tail, tailBoard } from "../live/fan-out.ts";

export interface RequestLimits {
  readonly rateLimits: RateLimits;
  readonly ip: string | undefined;
  readonly signal?: AbortSignal;
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

function concurrentAdmission(capacity: number) {
  let active = 0;
  return () => {
    if (active >= capacity) return undefined;
    active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
    };
  };
}

function inboundAdmission(): RateLimits["reserveInbound"] {
  let inbound = 0;
  const byIp = new Map<string, number>();
  return (ip = "unknown") => {
    const fromIp = byIp.get(ip) ?? 0;
    if (inbound >= 20 || fromIp >= 4) return undefined;
    inbound++;
    byIp.set(ip, fromIp + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      inbound--;
      decrement(byIp, ip);
    };
  };
}

function authAdmission(now: () => number): RateLimits["admitAuth"] {
  // A failed authentication costs 3,000 integer units.
  const failures = tokenBuckets(now, 60_000, 1, 3_000);
  type Admission = Awaited<ReturnType<RateLimits["admitAuth"]>>;
  type Waiter = (admission: Admission) => void;
  type Pending = { count: number; waiters: Set<Waiter> };
  const pending = new Map<string, Pending>();
  const reserveWaiter = concurrentAdmission(256);

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
        resolve(next);
      }
      if (active.count === 0 && active.waiters.size === 0) pending.delete(ip);
    };
  }

  return async (ip, signal) => {
    signal?.throwIfAborted();
    const active = pending.get(ip) ?? { count: 0, waiters: new Set<Waiter>() };
    const admission = admit(ip, active);
    if (typeof admission === "number") return admission;
    pending.set(ip, active);
    if (admission !== undefined) return admission;
    const release = reserveWaiter();
    if (!release) return 1;
    return new Promise<Admission>((resolve, reject) => {
      const cleanup = () => {
        signal?.removeEventListener("abort", abort);
        active.waiters.delete(waiter);
        release();
      };
      const waiter: Waiter = (next) => {
        cleanup();
        resolve(next);
      };
      const abort = () => {
        cleanup();
        reject(signal?.reason);
      };
      active.waiters.add(waiter);
      signal?.addEventListener("abort", abort, { once: true });
    });
  };
}

export function requestRateLimits(
  now: () => number,
  platform: PlatformView,
  { perPrincipal = 20, perOrganization = 500 }: NonNullable<ServerConfig["streamLimits"]> = {},
  observeStream?: (delta: 1 | -1) => void,
): RateLimits & { reserveLiveWait: ReturnType<typeof concurrentAdmission> } {
  // Integer units: a write costs 1,000 and a refresh costs 10,000.
  const writes = tokenBuckets(now, 1_000_000, 200, 1_000);
  const refreshes = tokenBuckets(now, 60_000, 1, 10_000);
  const byOrg = new Map<string, number>();
  const byPrincipal = new Map<string, number>();

  return {
    reserveInbound: inboundAdmission(),
    // Limit each direction to 64 MiB of attachment payloads per instance.
    reserveUpload: concurrentAdmission(16),
    reserveDownload: concurrentAdmission(16),
    reserveLiveWait: concurrentAdmission(500),
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
    admitAuth: authAdmission(now),
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
  const count = counts.get(key);
  if (count === undefined) return;
  if (count <= 1) counts.delete(key);
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

/** Hold a single instance-wide slot until the subscription has closed. */
export async function withLiveWait<T>(
  limits: RateLimits,
  board: Parameters<typeof tailBoard>[0],
  position: number | undefined,
  run: (tail: Tail) => Promise<T>,
): Promise<T> {
  // The instance attaches this local limit to the rate limits carried through the pipeline.
  if (!("reserveLiveWait" in limits) || typeof limits.reserveLiveWait !== "function") {
    throw new Error("missing instance live wait admission");
  }
  const release = limits.reserveLiveWait();
  if (!release) {
    throw new BoardError("rate_limited", "too many active long polls", {
      next: [{ kind: "wait", seconds: 1 }],
    });
  }
  try {
    const tail = tailBoard(board, position);
    try {
      return await run(tail);
    } finally {
      tail.close();
    }
  } finally {
    release();
  }
}
