import { operations } from "@openboard/contract";
import { BACKFILL_BOARD_ORG_JOB, type Bucket, type Jobs, type Store } from "@openboard/ports";
import { verifiers } from "./auth/chain.ts";
import { loginProviders } from "./auth/providers/index.ts";
import type { Deps, ServerConfig } from "./deps.ts";
import { readinessCheck } from "./http/health.ts";
import { requestRateLimits } from "./http/limits.ts";
import { handle, type Pipeline } from "./http/pipeline.ts";
import { routeTable } from "./http/router.ts";
import { tenants } from "./http/scope.ts";
import { staticFiles } from "./http/static.ts";
import { startBoardOrgBackfill } from "./jobs/board-org-startup.ts";
import { startExportJobs } from "./jobs/export-org.ts";
import { startDumpJob } from "./jobs/dump.ts";
import { type JobHandlers, startBoardJobs, startJobs } from "./jobs/registry.ts";
import { logShippingJobs } from "./jobs/ship-log.ts";

export const DRAIN_TIMEOUT_MS = 10_000;

/** The ports the server runs on; it never sees a driver. */
export interface Ports {
  readonly store: Store;
  readonly jobs: Jobs;
  readonly bucket?: Bucket;
}

/** One server instance: everything hangs off it, so two apps in one process share nothing (5.6). */
export function createApp(config: ServerConfig, ports: Ports, deps: Deps, handlers: JobHandlers = {}) {
  const shutdown = new AbortController();
  const active = new Set<Promise<unknown>>();
  const track = <T>(work: Promise<T>) => {
    active.add(work);
    return work.finally(() => active.delete(work));
  };
  const platform = ports.store.platform();
  const bucket = config.mode === "hosted" ? ports.bucket : undefined;
  const pipeline: Pipeline = {
    bucket,
    shutdown: shutdown.signal,
    staticFiles: staticFiles(config.publicUrl, config.webDir),
    schemaReady: readinessCheck(() => ports.store.schemaReady()),
    track,
    config,
    deps,
    rateLimits: requestRateLimits(deps.now, platform, config.streamLimits),
    routes: routeTable(
      operations.filter(({ scope, route }) => scope === "board" || (scope === "public" && !route.mount)),
    ),
    platformRoutes: routeTable(
      operations.filter(({ scope, route }) => scope === "account" || scope === "org" || route.mount),
    ),
    tenants: tenants(ports.store),
    platform,
    chain: verifiers(config, platform, deps),
    providers: loginProviders(config, deps),
  };
  if (config.mode === "hosted" && !bucket) deps.log.info("log shipping is off", {});
  const stopJobs = startBoardJobs(ports.jobs, pipeline.tenants, deps, config.instanceId, handlers, bucket);
  const stopExports = bucket && startExportJobs(ports.jobs, pipeline.tenants, deps, config.instanceId, bucket);
  const stopDump = startDumpJob(ports.store.dumpIfMissing, bucket, deps);
  // Large bucket purges can outlive a lease. Give shipping its own runner so purges cannot occupy every poller.
  const stopShipping =
    bucket &&
    startJobs(
      ports.jobs,
      pipeline.tenants,
      deps,
      config.instanceId,
      logShippingJobs(bucket, platform, pipeline.tenants, deps, shutdown.signal),
    );
  const stopBackfill = Object.hasOwn(handlers, BACKFILL_BOARD_ORG_JOB)
    ? startBoardOrgBackfill(platform, deps)
    : undefined;
  const stopBackground = async (release = false) => {
    await Promise.all([stopJobs, stopExports, stopShipping, stopBackfill, stopDump].map((stop) => stop?.(release)));
  };
  let draining: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  async function finishDrain() {
    const timeout = Promise.withResolvers<void>();
    const cancel = deps.schedule(DRAIN_TIMEOUT_MS, timeout.resolve);
    try {
      await Promise.race([Promise.allSettled([...active, stopBackground(true)]), timeout.promise]);
    } finally {
      cancel();
    }
  }
  return {
    fetch: (request: Request, connection?: { readonly ip?: string | undefined }): Promise<Response> =>
      track(handle(request, pipeline, connection?.ip)),
    drain() {
      if (!draining) {
        draining = finishDrain();
        shutdown.abort();
      }
      return draining;
    },
    /** Releases the ports it was given. */
    close() {
      closing ??= (draining ?? stopBackground()).finally(() => ports.store.close());
      return closing;
    },
  };
}

export type App = ReturnType<typeof createApp>;
