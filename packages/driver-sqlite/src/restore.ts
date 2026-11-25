import { Database } from "bun:sqlite";
import { chmod, link, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { BoardError } from "@openboard/contract";
import { migrations, query, type ReadAttachmentBackup, replayBoard, restoreStatements } from "@openboard/driver-sql";
import { sqliteBlobs } from "./blobs.ts";
import { sqliteDialect } from "./dialect.ts";
import { migrate } from "./migrate.ts";
import { connection } from "./open.ts";

const keys = { orgId: 1, boardId: 1 };
const databaseName = "board.db";

interface RestoreSource {
  snapshot: () => Promise<ReadableStream<Uint8Array>>;
  before?: number;
  events?: (head: number) => AsyncIterable<readonly unknown[]>;
  attachment?: ReadAttachmentBackup;
  blob: (sha256: string) => Promise<ReadableStream<Uint8Array> | null>;
}

export function localSnapshot(path: string): RestoreSource {
  const blobs = sqliteBlobs(dirname(dirname(resolve(path))));
  return {
    async snapshot() {
      if (!(await Bun.file(path).exists())) throw new BoardError("invalid_request", "Snapshot file does not exist");
      return Bun.file(path).stream();
    },
    blob: (sha256) => blobs.get({ orgId: keys.orgId, sha256 }),
  };
}

export class SnapshotAfterCutoff extends Error {}

export class RestoreDestinationExists extends BoardError {
  constructor() {
    super("invalid_request", "Restore destination already contains a database");
  }
}

export class MissingBackupBlob extends BoardError {
  constructor(sha256: string) {
    super("invalid_request", `Missing attachment blob ${sha256}`);
  }
}

async function writeSnapshot(path: string, snapshot: ReadableStream<Uint8Array>) {
  const sink = Bun.file(path).writer();
  try {
    for await (const chunk of snapshot) {
      sink.write(chunk);
      await sink.flush();
    }
  } finally {
    await sink.end();
  }
}

async function rebuild(path: string, source: RestoreSource) {
  await writeSnapshot(path, await source.snapshot());
  await chmod(path, 0o600);
  using database = new Database(path, { readwrite: true, create: false, strict: true });
  const db = connection(database, undefined, () => undefined);
  const [board] = await query(db, sqliteDialect, restoreStatements.restoreBoard, keys);
  if (!board) throw new BoardError("invalid_request", "Snapshot does not contain local/main");
  if (source.before !== undefined && Number.isFinite(source.before)) {
    const [latest] = await query(db, sqliteDialect, restoreStatements.restoreLatestEventTime, keys);
    if (latest?.at != null && Number(latest.at) >= source.before) throw new SnapshotAfterCutoff();
  }
  database.run("PRAGMA foreign_keys = OFF");
  migrate(database, migrations, Date.now());
  let replayed = 0;
  if (source.events && source.attachment) {
    for await (const batch of source.events(Number(board.head))) {
      await replayBoard(db, sqliteDialect, keys, batch as Parameters<typeof replayBoard>[3], source.attachment);
      replayed += batch.length;
    }
  }
  const rows = await query(db, sqliteDialect, restoreStatements.restoreBlobs, keys);
  return { replayed, hashes: rows.map((row) => String(row.sha256)) };
}

async function fetchBlobs(dir: string, hashes: readonly string[], blob: RestoreSource["blob"], requireBlobs: boolean) {
  const blobs = sqliteBlobs(dir);
  for (const sha256 of hashes) {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Invalid snapshot attachment hash");
    const body = await blob(sha256);
    if (!body) {
      // A standalone SQLite snapshot contains metadata only. Its sibling blob store is optional.
      if (!requireBlobs) continue;
      throw new MissingBackupBlob(sha256);
    }
    const bytes = await new Response(body).bytes();
    if (Bun.CryptoHasher.hash("sha256", bytes, "hex") !== sha256)
      throw new BoardError("invalid_request", `Attachment blob ${sha256} failed its checksum`);
    await blobs.put({ orgId: keys.orgId, sha256 }, bytes, 0);
  }
}

async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function ensureRestoreTarget(dir: string) {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    if (await exists(join(dir, databaseName + suffix))) throw new RestoreDestinationExists();
  }
}

async function publish(staged: string, dir: string, hashes: readonly string[]) {
  if (!(await exists(dir))) {
    await rename(staged, dir);
    return;
  }
  await ensureRestoreTarget(dir);
  // An existing directory can hold the source snapshot and its blobs. Publish the database last.
  const from = sqliteBlobs(staged);
  const to = sqliteBlobs(dir, true);
  for (const sha256 of hashes) {
    const key = { orgId: keys.orgId, sha256 };
    const body = await from.get(key);
    if (body) await to.put(key, await new Response(body).bytes(), 0);
  }
  try {
    await link(join(staged, databaseName), join(dir, databaseName));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new RestoreDestinationExists();
    throw error;
  }
}

export async function stageSqlite<T extends { hashes: string[] }>(
  destination: string,
  rebuild: (path: string) => Promise<T>,
  blob: RestoreSource["blob"],
  requireBlobs: boolean,
  publishStaged = publish,
) {
  const dir = resolve(destination);
  await ensureRestoreTarget(dir);
  const parent = dirname(dir);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const staged = await mkdtemp(join(parent, ".openboard-restore-"));
  try {
    const result = await rebuild(join(staged, databaseName));
    await fetchBlobs(staged, result.hashes, blob, requireBlobs);
    await publishStaged(staged, dir, result.hashes);
    return result;
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
}

export async function restoreSqlite(destination: string, source: RestoreSource) {
  const { replayed } = await stageSqlite(destination, (path) => rebuild(path, source), source.blob, !!source.events);
  return replayed;
}
