import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Bucket, PlatformView } from "@openboard/ports";
import type { Deps } from "@openboard/server";

const timedSnapshot = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.sqlite$/;
const migrationSnapshot = /^pre-migrate-\d+\.sqlite$/;
const retryInterval = 10_000;
const stallTimeout = 60_000;

async function upload(bucket: Bucket, key: string, file: Bun.BunFile, deps: Deps, shutdown: AbortSignal) {
  const stall = new AbortController();
  const signal = AbortSignal.any([shutdown, stall.signal]);
  const arm = () => deps.schedule(stallTimeout, () => stall.abort());
  let cancel = arm();
  signal.addEventListener("abort", () => cancel(), { once: true });
  try {
    const monitor = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        cancel();
        cancel = arm();
        controller.enqueue(chunk);
      },
    });
    // Keep ownership until the PUT settles, even if S3 is still committing after EOF.
    await bucket.putStream(key, file.stream().pipeThrough(monitor, { signal }));
    signal.throwIfAborted();
  } finally {
    cancel();
    stall.abort();
  }
}

async function snapshotObjectName(name: string, path: string) {
  if (!migrationSnapshot.test(name)) return name;
  // The migration copy keeps its version-based name locally. Its persisted mtime gives
  // it a stable UTC key with finer precision than the timed copies.
  const { mtimeNs } = await stat(path, { bigint: true });
  const time = new Date(Number(mtimeNs / 1_000_000n)).toISOString().replaceAll(":", "-");
  const nanos = String(mtimeNs % 1_000_000n).padStart(6, "0");
  return `${time.slice(0, -1)}${nanos}Z.sqlite`;
}

async function shipRetainedSnapshots(
  bucket: Bucket,
  platform: PlatformView,
  dir: string,
  deps: Deps,
  signal: AbortSignal,
) {
  const board = await platform.findBoard("local", "main");
  if (!board) throw new Error("Local board missing");
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const files = entries.filter(
    (entry) => entry.isFile() && (timedSnapshot.test(entry.name) || migrationSnapshot.test(entry.name)),
  );
  let failure: unknown;
  for (const { name } of files) {
    signal.throwIfAborted();
    try {
      const path = join(dir, name);
      const key = `org/${board.orgId}/snapshots/${await snapshotObjectName(name, path)}`;
      if (await bucket.exists(key, deps.now() + retryInterval)) continue;
      signal.throwIfAborted();
      await upload(bucket, key, Bun.file(path), deps, signal);
    } catch (error) {
      failure = error;
    }
  }
  if (failure) throw failure;
}

/** The retained snapshots are the retry queue, including after a restart. */
export function snapshotShipping(bucket: Bucket, platform: () => PlatformView, dir: string, deps: Deps) {
  const shutdown = new AbortController();
  let pending = false;
  let running = false;
  let cancelRetry: (() => void) | undefined;

  async function ship() {
    if (running || shutdown.signal.aborted) return;
    running = true;
    cancelRetry?.();
    cancelRetry = undefined;
    try {
      do {
        pending = false;
        await shipRetainedSnapshots(bucket, platform(), dir, deps, shutdown.signal);
      } while (pending && !shutdown.signal.aborted);
    } catch {
      if (!shutdown.signal.aborted) {
        deps.log.error("SQLite snapshot upload failed", {});
        cancelRetry = deps.schedule(retryInterval, ship);
      }
    } finally {
      running = false;
    }
  }

  return {
    refresh() {
      pending = true;
      // At startup the composition root still needs to finish opening its store.
      queueMicrotask(() => void ship());
    },
    stop() {
      shutdown.abort();
      cancelRetry?.();
    },
  };
}
