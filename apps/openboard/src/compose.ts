import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, type Deps, jsonLogger } from "@openboard/server";
import type { Config } from "./config.ts";

/** The one place a driver is chosen: local mode on SQLite, in the configured data directory. */
export function compose(config: Config, localOwnerTokenHash: string) {
  const now = () => Date.now();
  const deps: Deps = { now, log: jsonLogger({ now }), requestId: () => crypto.randomUUID() };
  return createApp(
    { mode: "local", publicUrl: config.publicUrl, localOwner: config.localOwner, localOwnerTokenHash },
    { store: sqliteDriver({ dir: config.dataDir, sync: config.sync }, deps.now) },
    deps,
  );
}
