import process from "node:process";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp } from "@openboard/server";

/**
 * One app on its own store. Hosted mode runs on SQLite too until the Postgres driver exists (M5): its counters and
 * conformance score are the local ones until then.
 */
function bootApp(mode: "local" | "hosted") {
  const now = () => Date.now();
  const log = {
    /** Request lines stay quiet here: the bench measures requests and conformance prints its own report. */
    info: () => {},
    error: (message: string, fields: object) => process.stderr.write(`${JSON.stringify({ message, ...fields })}\n`),
  };
  return createApp(
    // The bench serves no port: discovery's URL is never read here.
    { mode, publicUrl: "http://127.0.0.1", localOwner: "ob:user:local-tools" },
    { store: sqliteDriver({ memory: true }, now) },
    { now, log, requestId: () => crypto.randomUUID() },
  );
}

export type Mode = "local" | "hosted";

export const modes: readonly Mode[] = ["local", "hosted"];

/** Hosted mode always runs as two stateless instances (docs/codebase.md 6.6). */
const instancesPerMode: Record<Mode, number> = { local: 1, hosted: 2 };

/** Boots every instance of `mode` in this process and returns them with one `close` for all. */
export function boot(mode: Mode) {
  const apps = Array.from({ length: instancesPerMode[mode] }, () => bootApp(mode));
  return {
    apps,
    async close() {
      await Promise.all(apps.map((app) => app.close()));
    },
  };
}
