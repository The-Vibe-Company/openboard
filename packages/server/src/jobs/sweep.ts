import type { PlatformView } from "@openboard/ports";
import type { Deps } from "../deps.ts";
import { errorMessage } from "../log.ts";

const sweepInterval = 60_000;

/** Opportunistic maintenance uses the existing runner wake, with no dedicated timer. */
export function sweepOnActivity(platform: Pick<PlatformView, "sweepExpired">, deps: Deps) {
  let nextSweep = Number.NEGATIVE_INFINITY;
  return async () => {
    const now = deps.now();
    if (now < nextSweep) return;
    nextSweep = now + sweepInterval;
    try {
      await platform.sweepExpired(now);
    } catch (error) {
      deps.log.error("operational retention sweep failed", { error: errorMessage(error) });
    }
  };
}
