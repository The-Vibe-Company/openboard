import { parseArgs } from "node:util";
import { ATTACHMENT_ID_PATTERN, BoardError } from "@openboard/contract";
import type { Bucket } from "@openboard/ports";
import { backupBucket } from "./bucket.ts";
import {
  ensureRestoreTarget,
  localSnapshot,
  MissingBackupBlob,
  restorePostgres,
  restoreSqlite,
  SnapshotAfterCutoff,
} from "./compose.ts";
import type { Config } from "./config.ts";

import { decodeEventSegment } from "./event-segment.ts";

const prefix = "org/1/";
const snapshotTime = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}\.\d{3,9}Z)\.sqlite$/;
const segmentName = /^(\d+)-(\d+)\.ndjson\.gz$/;
const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,9}))?(?:Z|[+-]\d{2}:\d{2})$/;

function invalid(message: string): never {
  throw new BoardError("invalid_request", message);
}

const restoreUsage = [
  "Usage: openboard restore [--to <directory>] [--from <snapshot> | --at <ISO time>]",
  "       openboard restore --org <slug> | --after-dump",
  "Hosted restore reads OPENBOARD_DATABASE_URL and the OPENBOARD_BACKUP_S3_* settings.",
  "Use --after-dump after pg_restore of dumps/<YYYY-MM-DD>.dump. Replay starts at the log positions",
  "in that restored database and includes later shipped segments. Stop serving traffic during recovery.",
].join("\n");

function options(args: readonly string[]) {
  try {
    return parseArgs({
      args: [...args],
      options: {
        to: { type: "string" },
        from: { type: "string" },
        at: { type: "string" },
        org: { type: "string" },
        "after-dump": { type: "boolean" },
        help: { type: "boolean" },
      },
    }).values;
  } catch {
    return invalid("Run openboard restore --help for usage");
  }
}

function instant(at: string, fraction: string) {
  const millis = Date.parse(at);
  if (!Number.isFinite(millis)) return invalid(`Invalid ISO timestamp ${at}`);
  return { millis, remainder: Number(fraction.padEnd(9, "0").slice(3)) };
}

function precedes(a: ReturnType<typeof instant>, b: ReturnType<typeof instant>) {
  return a.millis < b.millis || (a.millis === b.millis && a.remainder < b.remainder);
}

async function snapshotsBefore(bucket: Bucket, cutoff: ReturnType<typeof instant> | undefined) {
  const path = `${prefix}snapshots/`;
  const entries: { key: string; time: ReturnType<typeof instant> }[] = [];
  for await (const key of bucket.list(path)) {
    const match = snapshotTime.exec(key.slice(path.length));
    if (!match) continue;
    const date = `${match[1]}:${match[2]}:${match[3]}`;
    if (!Number.isFinite(Date.parse(date))) continue;
    const time = instant(date, match[3]?.slice(3, -1) ?? "");
    if (!cutoff || precedes(time, cutoff)) entries.push({ key, time });
  }
  return entries.sort((a, b) => b.time.millis - a.time.millis || b.time.remainder - a.time.remainder);
}

async function object(bucket: Bucket, key: string) {
  return (await bucket.read(key)) ?? invalid(`Missing backup object ${key}`);
}

async function segments(bucket: Bucket) {
  const path = `${prefix}board/1/`;
  const result: { first: number; last: number; key: string }[] = [];
  for await (const key of bucket.list(path)) {
    const match = segmentName.exec(key.slice(path.length));
    if (!match) continue;
    const first = Number(match[1]);
    const last = Number(match[2]);
    if (!Number.isSafeInteger(last) || !Number.isSafeInteger(first) || first < 1 || first > last)
      invalid(`Invalid backup segment ${key}`);
    result.push({ first, last, key });
  }
  return result.sort((a, b) => a.first - b.first || b.last - a.last);
}

async function eventsIn(bucket: Bucket, key: string, first: number, last: number) {
  const body = await object(bucket, key);
  try {
    return decodeEventSegment(await new Response(body).arrayBuffer(), first, last);
  } catch {
    return invalid(`Invalid or incomplete backup segment ${key}`);
  }
}

async function* replay(bucket: Bucket, head: number, before: number) {
  const snapshotHead = head;
  for (const { first, last, key } of await segments(bucket)) {
    if (last <= head) continue;
    if (head > snapshotHead && first <= head) invalid(`Overlapping backup segment ${key}`);
    if (first > head + 1) invalid(`Missing backup segment covering events ${head + 1}-${first - 1} before ${key}`);
    const events = (await eventsIn(bucket, key, first, last)).filter((event) => event.id > head);
    const stop = events.findIndex((event) => event.at >= before);
    if (stop >= 0) {
      const beforeCutoff = events.slice(0, stop);
      const lastBeforeCutoff = beforeCutoff.at(-1);
      if (lastBeforeCutoff) yield { events: beforeCutoff, through: lastBeforeCutoff.id };
      return;
    }
    yield { events, through: last };
    head = last;
  }
}

async function attachment(bucket: Bucket, id: string) {
  if (!ATTACHMENT_ID_PATTERN.test(id)) return invalid("Invalid attachment ID in backup");
  const key = `${prefix}attachments/1/${id}.json`;
  const body = await bucket.read(key);
  if (!body) return null;
  const value = (await new Response(body).json()) as {
    sha256: string;
    uploader?: string;
    at?: number;
    gcEnqueued?: number | null;
    shippedAt?: number;
  } | null;
  if (
    !value ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    (value.uploader !== undefined && typeof value.uploader !== "string") ||
    (value.at !== undefined && !Number.isSafeInteger(value.at)) ||
    (value.gcEnqueued !== undefined && ![null, 0, 1].includes(value.gcEnqueued)) ||
    (value.shippedAt !== undefined && !Number.isSafeInteger(value.shippedAt))
  )
    return invalid(`Invalid attachment metadata ${key}`);
  return value;
}

async function restoreFromBucket(to: string, bucket: Bucket, cutoff: ReturnType<typeof instant> | undefined) {
  // Event timestamps are integer milliseconds. Round the exclusive bound up when needed.
  const before = cutoff ? cutoff.millis + Number(cutoff.remainder !== 0) : Infinity;
  let missingBlob: MissingBackupBlob | undefined;
  for (const { key } of await snapshotsBefore(bucket, cutoff)) {
    try {
      const replayed = await restoreSqlite(to, {
        before,
        snapshot: () => object(bucket, key),
        events: (head) => replay(bucket, head, before),
        attachment: (id) => attachment(bucket, id),
        blob: (hash) => bucket.read(`${prefix}blobs/sha256/${hash}`),
      });
      return { snapshot: key, replayed };
    } catch (error) {
      if (error instanceof MissingBackupBlob) missingBlob ??= error;
      else if (!(error instanceof SnapshotAfterCutoff)) throw error;
    }
  }
  if (missingBlob) throw missingBlob;
  return invalid("No backup snapshot available before the requested time");
}

export async function restore(
  config: Config,
  args: readonly string[],
  output: { out(line: string): void; err(line: string): void },
  openBucket = backupBucket,
  restoreHosted = restorePostgres,
): Promise<number> {
  try {
    const parsed = options(args);
    const { to = config.dataDir, from, at, org, "after-dump": afterDump, help } = parsed;
    if (help) {
      output.out(restoreUsage);
      return 0;
    }
    if (config.mode === "hosted") {
      if (
        parsed.to !== undefined ||
        from !== undefined ||
        at !== undefined ||
        (org !== undefined) === Boolean(afterDump) ||
        org === ""
      )
        invalid("Hosted restore requires exactly one of --org <slug> or --after-dump");
      const settings = config.backup ?? invalid("Configure a backup bucket with OPENBOARD_BACKUP_S3_*");
      await restoreHosted(
        config.databaseUrl,
        openBucket(settings, Date.now),
        org !== undefined ? { org } : { afterDump: true },
        (slug, replayed) => output.out(`Restored ${slug}; replayed ${replayed} events`),
      );
      return 0;
    }
    if (org !== undefined || afterDump) invalid("Hosted restore requires OPENBOARD_DATABASE_URL");
    const atMatch = at === undefined ? null : isoTime.exec(at);
    if (at !== undefined && (!atMatch || from !== undefined))
      invalid("--at requires an ISO timestamp and a configured bucket");
    const cutoff = at === undefined ? undefined : instant(at, atMatch?.[1] ?? "");
    if (!to.trim() || from === "") invalid("Restore paths must be nonempty");
    await ensureRestoreTarget(to);
    if (from !== undefined) {
      const replayed = await restoreSqlite(to, localSnapshot(from));
      output.out(`Restored ${from}; replayed ${replayed} events`);
    } else {
      const settings = config.backup ?? invalid("Configure a backup bucket or pass --from <snapshot>");
      const bucket = openBucket(settings, Date.now);
      const { snapshot, replayed } = await restoreFromBucket(to, bucket, cutoff);
      output.out(`Restored ${snapshot}; replayed ${replayed} events`);
    }
    return 0;
  } catch (error) {
    if (error instanceof BoardError) {
      output.err(`error: ${error.code}: ${error.message}`);
      return error.code === "invalid_request" ? 2 : 1;
    }
    output.err(`error: internal: Could not restore the ${config.mode === "hosted" ? "Postgres" : "SQLite"} database`);
    return 1;
  }
}
