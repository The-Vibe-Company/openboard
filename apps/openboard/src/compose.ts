import process from "node:process";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, type Deps } from "@openboard/server";
import type { Config } from "./config.ts";

/** The one place a driver is chosen: local mode on SQLite, in memory until a data directory survives a restart. */
export function compose(config: Config) {
  const deps: Deps = {
    now: () => Date.now(),
    log: {
      error: (msg, fields) =>
        process.stderr.write(`${JSON.stringify({ t: Date.now(), level: "error", msg, ...fields })}\n`),
    },
  };
  return createApp(
    { mode: "local", localOwner: config.localOwner },
    { store: sqliteDriver({ memory: true }, deps.now) },
    deps,
  );
}
