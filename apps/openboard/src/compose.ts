import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, type Deps, jsonLogger } from "@openboard/server";
import type { Config } from "./config.ts";

/** The one place a driver is chosen: local mode on SQLite, in memory until a data directory survives a restart. */
export function compose(config: Config, localOwnerTokenHash: string) {
  const now = () => Date.now();
  const deps: Deps = { now, log: jsonLogger({ now }) };
  return createApp(
    { mode: "local", localOwner: config.localOwner, localOwnerTokenHash },
    { store: sqliteDriver({ memory: true }, deps.now) },
    deps,
  );
}
