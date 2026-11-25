import { lookup } from "node:dns/promises";
import { join } from "node:path";
import { migratePostgres, postgresDriver } from "@openboard/driver-postgres";
import { sqliteDriver } from "@openboard/driver-sqlite";
import type { PlatformView, Store } from "@openboard/ports";
import { createApp, type Deps, jsonLogger, maintenanceJobs, usageJobs } from "@openboard/server";
import { snapshotShipping } from "./backup.ts";
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

async function prepareLocalStore(store: Store) {
  try {
    const platform = store.platform();
    const keys = await platform.findBoard("local", "main");
    if (!keys) throw new Error("Local board is missing");
    await platform.reprojectBoard(keys, true);
  } catch (error) {
    await store.close();
    throw error;
  }
}

/** The one place a driver is chosen: SQLite for local mode, Postgres for hosted mode. */
export async function compose(
  config: Config,
  localOwnerTokenHash?: string,
  overrides?: { readonly deps: Pick<Deps, "now" | "schedule" | "log">; readonly backupBucket: typeof backupBucket },
) {
  const now = overrides?.deps.now ?? Date.now;
  const deps: Deps = {
    now,
    residentBytes: () => process.memoryUsage.rss(),
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
    ...overrides?.deps,
  };
  const { mode, publicUrl, localOwner, signup, github } = config;
  const bucket = config.backup ? (overrides?.backupBucket ?? backupBucket)(config.backup, deps.now) : undefined;
  if (mode === "local" && !bucket) deps.log.info("log shipping is off", {});
  const snapshots =
    mode === "local" && bucket
      ? snapshotShipping(bucket, (): PlatformView => store.platform(), join(config.dataDir, "backups"), deps)
      : undefined;
  const store =
    config.mode === "hosted"
      ? await hostedStore(config.databaseUrl, deps.now)
      : sqliteDriver(
          {
            dir: config.dataDir,
            sync: config.sync,
            ...(overrides && { scheduleSnapshot: deps.schedule }),
            ...(snapshots && { onSnapshot: snapshots.refresh }),
            onSnapshotError: () => deps.log.error("SQLite snapshot failed", {}),
          },
          deps.now,
        );
  if (mode === "local") await prepareLocalStore(store);
  const app = createApp(
    {
      mode,
      ...(config.secretKey && { secretKey: config.secretKey }),
      publicUrl,
      webhookTargets: config.webhookTargets,
      webhookCustomSigning: config.webhookCustomSigning,
      localOwner,
      instanceId: config.instanceId,
      ...(config.metricsTokenHash && { metricsTokenHash: config.metricsTokenHash }),
      deploymentTag: config.deploymentTag,
      ...(mode === "local" && localOwnerTokenHash && { localOwnerTokenHash }),
      signup,
      ...(github && { signIn: { github } }),
    },
    { store, blobs: store.blobs, jobs: store.jobs, ...(bucket && { bucket }) },
    deps,
    { ...maintenanceJobs, ...usageJobs },
  );
  if (!snapshots) return app;
  snapshots.refresh();
  return {
    fetch: app.fetch,
    drain() {
      snapshots.stop();
      return app.drain();
    },
    close() {
      snapshots.stop();
      return app.close();
    },
  };
}

export {
  ensureRestoreTarget,
  importSqlite,
  localSnapshot,
  MissingBackupBlob,
  RestoreDestinationExists,
  restoreSqlite,
  SnapshotAfterCutoff,
} from "@openboard/driver-sqlite";
