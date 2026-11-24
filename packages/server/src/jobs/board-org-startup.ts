import type { PlatformView } from "@openboard/ports";
import type { Deps } from "../deps.ts";

/** Start the sweep without delaying readiness, and retry transient database failures while serving. */
export function startBoardOrgBackfill(
  platform: Pick<PlatformView, "queueBoardOrgBackfill">,
  deps: Deps,
): () => Promise<void> {
  const shutdown = new AbortController();
  let active: Promise<void>;
  let cancelRetry: (() => void) | undefined;

  async function sweep() {
    try {
      await platform.queueBoardOrgBackfill(deps.now(), shutdown.signal);
    } catch {
      if (shutdown.signal.aborted) return;
      deps.log.error("could not queue board organization backfill", {});
      cancelRetry = deps.schedule(1000, () => {
        active = sweep();
      });
    }
  }

  active = sweep();
  return async () => {
    shutdown.abort();
    cancelRetry?.();
    await active;
  };
}
