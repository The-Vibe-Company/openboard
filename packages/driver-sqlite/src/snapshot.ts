import { Database } from "bun:sqlite";
import {
  chmodSync,
  closeSync,
  type Dirent,
  promises as fs,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";

const interval = 6 * 60 * 60 * 1000;
const retention = 8;
const snapshotName = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.sqlite$/;

type Schedule = (delay: number, run: () => Promise<void>) => () => void;

export interface SnapshotOptions {
  readonly scheduleSnapshot?: Schedule;
  readonly onSnapshotError?: () => void;
}

function schedule(delay: number, run: () => Promise<void>): () => void {
  const timer = setTimeout(run, delay);
  timer.unref();
  return () => clearTimeout(timer);
}

function syncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function vacuumCopy(file: string, copy: string): void {
  using reader = new Database(file, { readonly: true, strict: true });
  reader.run("PRAGMA busy_timeout = 5000");
  reader.run("VACUUM INTO ?", [copy]);
  chmodSync(copy, 0o600);
  syncPath(copy);
}

function stagingDirectory(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(dir, ".snapshot-"));
}

function publishCopy(copy: string, dir: string, name: string): void {
  // Persist the new name before pruning old copies or migrating the source.
  renameSync(copy, join(dir, name));
  syncPath(dir);
  syncPath(dirname(dir));
}

function writeSnapshot(file: string, dir: string, name: string): void {
  const pending = stagingDirectory(dir);
  try {
    const copy = join(pending, name);
    vacuumCopy(file, copy);
    publishCopy(copy, dir, name);
  } finally {
    rmSync(pending, { recursive: true, force: true });
  }
}

function backupName(time: number): string {
  return `${new Date(time).toISOString().replaceAll(":", "-")}.sqlite`;
}

function expiredSnapshots(entries: readonly Dirent[]): string[] {
  const copies = entries
    .filter((entry) => entry.isFile() && snapshotName.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return copies.slice(0, -retention);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await fs.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishScheduledCopy(copy: string, dir: string, name: string): Promise<void> {
  await fs.rename(copy, join(dir, name));
  await syncDirectory(dir);
  await syncDirectory(dirname(dir));
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const expired of expiredSnapshots(entries)) await fs.rm(join(dir, expired), { force: true });
}

export function snapshotBeforeMigration(file: string, dir: string, version: number): void {
  const name = `pre-migrate-${version}.sqlite`;
  writeSnapshot(file, dir, name);
}

function copyOffThread(file: string, copy: string) {
  const worker = new Worker(new URL("./snapshot-worker.ts", import.meta.url));
  let finish: (success: boolean) => void = () => undefined;
  const done = new Promise<boolean>((resolve) => {
    finish = (success) => {
      worker.terminate();
      resolve(success);
    };
    worker.onmessage = ({ data }) => finish(data === true);
    worker.onerror = (event) => {
      event.preventDefault();
      finish(false);
    };
  });
  worker.postMessage({ file, copy });
  return { done, cancel: () => finish(false) };
}

export function startSnapshots(file: string, dir: string, now: () => number, options: SnapshotOptions) {
  const arm = options.scheduleSnapshot ?? schedule;
  let closed = false;
  let active: Promise<void> | undefined;
  let cancelCopy: (() => void) | undefined;

  const started = now();
  try {
    writeSnapshot(file, dir, backupName(started));
    for (const name of expiredSnapshots(readdirSync(dir, { withFileTypes: true }))) {
      rmSync(join(dir, name), { force: true });
    }
  } catch {
    options.onSnapshotError?.();
  }

  async function takeScheduledSnapshot(time: number): Promise<void> {
    const pending = stagingDirectory(dir);
    try {
      const name = backupName(time);
      const copy = join(pending, name);
      const task = copyOffThread(file, copy);
      cancelCopy = task.cancel;
      const success = await task.done;
      if (closed) return;
      if (!success) throw new Error("SQLite snapshot failed");
      await publishScheduledCopy(copy, dir, name);
    } finally {
      cancelCopy = undefined;
      await fs.rm(pending, { recursive: true, force: true });
    }
  }

  function next(start: number): () => void {
    const delay = Math.max(0, interval - Math.max(0, now() - start));
    return arm(delay, async () => {
      if (closed) return;
      const time = now();
      active = takeScheduledSnapshot(time);
      try {
        await active;
      } catch {
        options.onSnapshotError?.();
      } finally {
        active = undefined;
        if (!closed) cancel = next(time);
      }
    });
  }

  let cancel = next(started);
  return async () => {
    closed = true;
    cancel();
    // Release close() without waiting for a synchronous VACUUM in the worker.
    cancelCopy?.();
    await active?.catch(() => undefined);
  };
}
