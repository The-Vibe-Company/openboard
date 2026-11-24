import { lookup } from "node:dns/promises";
import { migratePostgres, postgresDriver } from "@openboard/driver-postgres";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, type Deps, jsonLogger, maintenanceJobs, usageJobs } from "@openboard/server";
import { backupBucket } from "./bucket.ts";
import type { Config } from "./config.ts";

async function hostedStore(url: string, now: () => number) {
  try {
    return await postgresDriver({ url }, now);
  } catch {
    // Connection errors can contain credentials supplied in the URL.
    throw new Error("Could not open or migrate the Postgres database");
  }
}

/**
 * `openboard migrate`: hosted mode migrates under the migration lock and reports each migration applied; local mode
 * opens the data directory, which the SQLite driver migrates on open. Returns the names applied (none locally).
 */
export async function migrateSchema(config: Config, onApplied: (name: string) => void): Promise<string[]> {
  if (config.mode === "local") {
    await sqliteDriver({ dir: config.dataDir, sync: config.sync }).close();
    return [];
  }
  try {
    return await migratePostgres({ url: config.databaseUrl }, Date.now, onApplied);
  } catch {
    // Connection errors can contain credentials supplied in the URL.
    throw new Error("Could not open or migrate the Postgres database");
  }
}

export async function withAdminStore<Result>(
  config: Config,
  run: (
    platform: ReturnType<Awaited<ReturnType<typeof hostedStore>>["platform"]>,
    now: () => number,
  ) => Promise<Result>,
) {
  const store =
    config.mode === "hosted"
      ? await hostedStore(config.databaseUrl, Date.now)
      : sqliteDriver({ dir: config.dataDir, sync: config.sync });
  try {
    return await run(store.platform(), Date.now);
  } finally {
    await store.close();
  }
}

/** The one place a driver is chosen: SQLite for local mode, Postgres for hosted mode. */
export async function compose(config: Config, localOwnerTokenHash?: string) {
  const now = () => Date.now();
  const deps: Deps = {
    now,
    log: jsonLogger({ now }),
    requestId: () => crypto.randomUUID(),
    schedule: (delayMs, run) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    fetch: (request) => fetch(request, { redirect: request.redirect === "manual" ? "manual" : "error" }),
    webhookFetch: (request, options) => fetch(request, options),
    resolveHost: async (hostname) => (await lookup(hostname, { all: true })).map(({ address }) => address),
  };
  const { mode, publicUrl, localOwner, signup, github } = config;
  const store =
    config.mode === "hosted"
      ? await hostedStore(config.databaseUrl, deps.now)
      : sqliteDriver(
          {
            dir: config.dataDir,
            sync: config.sync,
            onSnapshotError: () => deps.log.error("SQLite snapshot failed", {}),
          },
          deps.now,
        );
  const bucket = mode === "hosted" && config.backup ? backupBucket(config.backup, deps.now) : undefined;
  return createApp(
    {
      mode,
      ...(config.secretKey && { secretKey: config.secretKey }),
      publicUrl,
      webhookTargets: config.webhookTargets,
      webhookCustomSigning: config.webhookCustomSigning,
      localOwner,
      instanceId: config.instanceId,
      deploymentTag: config.deploymentTag,
      ...(mode === "local" && localOwnerTokenHash && { localOwnerTokenHash }),
      signup,
      ...(github && { signIn: { github } }),
    },
    { store, jobs: store.jobs, ...(bucket && { bucket }) },
    deps,
    { ...maintenanceJobs, ...usageJobs },
  );
}
