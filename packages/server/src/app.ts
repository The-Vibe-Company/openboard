import { operations } from "@openboard/contract";
import type { Jobs, Store } from "@openboard/ports";
import { loginProviders } from "./auth/providers/index.ts";
import type { Deps, ServerConfig } from "./deps.ts";
import { handle, type Pipeline } from "./http/pipeline.ts";
import { routeTable } from "./http/router.ts";
import { tenants } from "./http/scope.ts";
import { type JobHandler, startJobs } from "./jobs/registry.ts";

export const DRAIN_TIMEOUT_MS = 10_000;

/** The ports the server runs on; it never sees a driver. */
export interface Ports {
  readonly store: Store;
  readonly jobs: Jobs;
}

/** One server instance: everything hangs off it, so two apps in one process share nothing (5.6). */
export function createApp(
  config: ServerConfig,
  ports: Ports,
  deps: Deps,
  handlers: Readonly<Record<string, JobHandler>> = {},
) {
  const shutdown = new AbortController();
  const active = new Set<Promise<unknown>>();
  const track = <T>(work: Promise<T>) => {
    active.add(work);
    return work.finally(() => active.delete(work));
  };
  const pipeline: Pipeline = {
    shutdown: shutdown.signal,
    track,
    config,
    deps,
    routes: routeTable(
      operations.filter(({ scope, route }) => scope === "board" || (scope === "public" && !route.mount)),
    ),
    platformRoutes: routeTable(
      operations.filter(({ scope, route }) => scope === "account" || scope === "org" || route.mount),
    ),
    tenants: tenants(ports.store),
    platform: ports.store.platform(),
    providers: loginProviders(config, deps),
  };
  const stopJobs = startJobs(ports.jobs, pipeline.tenants, deps, config.instanceId, handlers);
  let draining: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  async function finishDrain() {
    const timeout = Promise.withResolvers<void>();
    const cancel = deps.schedule(DRAIN_TIMEOUT_MS, timeout.resolve);
    try {
      await Promise.race([Promise.allSettled([...active, stopJobs(true)]), timeout.promise]);
    } finally {
      cancel();
    }
  }
  return {
    fetch: (request: Request): Promise<Response> => track(handle(request, pipeline)),
    drain() {
      if (!draining) {
        draining = finishDrain();
        shutdown.abort();
      }
      return draining;
    },
    /** Releases the ports it was given. */
    close() {
      closing ??= (draining ?? stopJobs()).finally(() => ports.store.close());
      return closing;
    },
  };
}

export type App = ReturnType<typeof createApp>;
