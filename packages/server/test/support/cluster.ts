import type { Store } from "@openboard/ports";
import { type App, createApp, type Deps, type ServerConfig } from "../../src/index.ts";
import type { TestStore } from "./drivers.ts";

/** What a test talks to: one app, or several instances behind one `fetch`, closed and drained together. */
export interface Cluster extends App {
  /** Each instance, in the order requests reach them: one on SQLite, two on Postgres. */
  readonly instances: readonly App[];
  /** The instance, counted from 1, that served each request so far, in the order the requests arrived. */
  readonly served: readonly number[];
}

/**
 * The apps a test runs on `store` (docs/codebase.md 6.1): one on SQLite; on Postgres two, the first on `store` and the
 * second on a sibling driver on the same database, as two processes would be, with `fetch` alternating between them so
 * consecutive requests land on different instances. `build` makes one instance on a store; whatever else it closes
 * over (the fake clock, request IDs, random bytes) the instances share.
 */
export function cluster(store: TestStore, build: (store: Store) => App): Cluster {
  const instances = [build(store), ...(store.sibling ? [build(store.sibling())] : [])];
  const served: number[] = [];
  return {
    instances,
    served,
    fetch(request) {
      const index = served.length % instances.length;
      served.push(index + 1);
      return instances[index]!.fetch(request);
    },
    async drain() {
      await Promise.all(instances.map((instance) => instance.drain()));
    },
    async close() {
      // Every instance closes, even when another one fails to.
      const closed = await Promise.allSettled(instances.map((instance) => instance.close()));
      const failed = closed.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
}

/** `createApp(config, ports, deps)` as a `cluster` on `ports.store`: every instance has the same config and deps. */
export function createCluster(config: ServerConfig, ports: { readonly store: TestStore }, deps: Deps): Cluster {
  return cluster(ports.store, (store) => createApp(config, { store }, deps));
}
