import { operations } from "@openboard/contract";
import type { Store } from "@openboard/ports";
import type { Deps, ServerConfig } from "./deps.ts";
import { handle, type Pipeline } from "./http/pipeline.ts";
import { routeTable } from "./http/router.ts";
import { tenants } from "./http/scope.ts";

/** The ports the server runs on; it never sees a driver. */
export interface Ports {
  readonly store: Store;
}

/** One server instance: everything hangs off it, so two apps in one process share nothing (5.6). */
export function createApp(config: ServerConfig, ports: Ports, deps: Deps) {
  const pipeline: Pipeline = { config, deps, routes: routeTable(operations), tenants: tenants(ports.store) };
  return {
    fetch: (request: Request): Promise<Response> => handle(request, pipeline),
    async drain() {},
    /** Releases the ports it was given. */
    async close() {
      await ports.store.close();
    },
  };
}

export type App = ReturnType<typeof createApp>;
