import process from "node:process";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, type Deps } from "@openboard/server";
import type { Config } from "./config.ts";

/** The one place a driver is chosen: local mode on SQLite, in the configured data directory. */
export function compose(config: Config, localOwnerTokenHash: string) {
  const deps: Deps = {
    now: () => Date.now(),
    log: {
      error: (msg, fields) =>
        process.stderr.write(`${JSON.stringify({ t: Date.now(), level: "error", msg, ...fields })}\n`),
    },
  };
  return createApp(
    { mode: "local", localOwner: config.localOwner, localOwnerTokenHash },
    { store: sqliteDriver({ dir: config.dataDir, sync: config.sync }, deps.now) },
    deps,
  );
}
