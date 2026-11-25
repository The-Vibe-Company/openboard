import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Attachment } from "@openboard/contract";
import { fakeBucket } from "@openboard/ports/testkit";
import { mintLocalOwnerToken } from "@openboard/server";
import { compose } from "../src/compose.ts";
import { loadConfig } from "../src/config.ts";

const start = Date.UTC(2026, 0, 1);
const sixHours = 6 * 60 * 60 * 1_000;
const prefix = "org/1/";

function fakeClock() {
  let time = start;
  const timers = new Map<() => void | Promise<void>, number>();
  const ready = Promise.withResolvers<void>();
  return {
    armed: ready.promise,
    now: () => time,
    schedule(delay: number, run: () => void | Promise<void>) {
      timers.set(run, time + delay);
      if (delay === 0) ready.resolve();
      return () => {
        timers.delete(run);
      };
    },
    async advance(at: number) {
      time = at;
      const dueTimers = Array.from(timers).filter(([, due]) => due <= at);
      for (const [run] of dueTimers) {
        if (!timers.delete(run)) continue;
        await run();
      }
    },
  };
}

async function withBoard(enabled: boolean, run: (fixture: Awaited<ReturnType<typeof startBoard>>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "openboard-local-backup-"));
  try {
    const board = await startBoard(dir, enabled);
    try {
      await run(board);
    } finally {
      await board.app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function startBoard(dir: string, enabled: boolean, loseUploadResponse = false) {
  const settings = {
    OPENBOARD_BACKUP_S3_ENDPOINT: "http://127.0.0.1:9000",
    OPENBOARD_BACKUP_S3_BUCKET: "backups",
    OPENBOARD_BACKUP_S3_REGION: "us-east-1",
    OPENBOARD_BACKUP_S3_ACCESS_KEY_ID: "sample-access",
    OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY: "sample-secret",
  };
  const config = loadConfig({ OPENBOARD_DATA_DIR: dir, ...(enabled && settings) });
  const owner = mintLocalOwnerToken(new Uint8Array(42).fill(7));
  const fixture = fakeBucket();
  const clock = fakeClock();
  const messages: string[] = [];
  const errors: string[] = [];
  const snapshotWrites = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  let uploadedSnapshots = 0;
  const snapshotError = Promise.withResolvers<void>();
  const snapshotProbes: string[] = [];
  const exists = fixture.bucket.exists;
  fixture.bucket.exists = async (key, deadline) => {
    if (key.startsWith(`${prefix}snapshots/`)) snapshotProbes.push(key);
    return exists(key, deadline);
  };
  const putStream = fixture.bucket.putStream;
  fixture.bucket.putStream = async (...args) => {
    await putStream(...args);
    snapshotWrites[uploadedSnapshots++]?.resolve();
    if (loseUploadResponse && uploadedSnapshots === 1) throw new Error("Response lost after upload");
  };
  let bucketOpens = 0;
  const app = await compose(config, owner.hash, {
    deps: {
      ...clock,
      log: {
        info: (message) => {
          messages.push(message);
        },
        error: (message) => {
          errors.push(message);
          if (message === "SQLite snapshot upload failed") snapshotError.resolve();
        },
      },
    },
    backupBucket() {
      bucketOpens++;
      return fixture.bucket;
    },
  });
  function send(path: string, body: string | Uint8Array<ArrayBuffer>, headers: Record<string, string>) {
    return app.fetch(
      new Request(`${config.publicUrl}/api/local/main/${path}`, {
        method: "POST",
        headers: { ...headers, authorization: `Bearer ${owner.token}` },
        body,
      }),
    );
  }
  return {
    ...fixture,
    app,
    clock,
    messages,
    errors,
    bucketOpens,
    snapshotWrites,
    snapshotProbes,
    snapshotError: snapshotError.promise,
    send,
    post: (text: string, attachments: string[] = []) =>
      send("messages", JSON.stringify({ channel: "dev", text, attachments }), { "content-type": "application/json" }),
  };
}

test("local SQLite ships 25 posts, one attachment and both snapshots once", async () => {
  await withBoard(true, async ({ clock, writes, objects, errors, send, post, snapshotWrites }) => {
    await clock.armed;
    await clock.advance(start);
    const bytes = Uint8Array.of(0, 255, 5);
    const upload = await send("attachments", bytes, { "content-type": "image/png", "x-board-filename": "test.png" });
    expect(upload.status).toBe(201);
    const { attachment } = (await upload.json()) as { attachment: Attachment };
    const texts = Array.from({ length: 25 }, (_, i) => `Ship ${i}`);
    for (const [index, message] of texts.entries()) {
      expect((await post(message, index === 0 ? [attachment.id] : [])).status).toBe(201);
    }
    const hash = Bun.CryptoHasher.hash("sha256", bytes, "hex");
    expect(writes.every((key) => key.startsWith(`${prefix}snapshots/`))).toBe(true);
    await clock.advance(start + 10_000);
    const segment = `${prefix}board/1/1-26.ndjson.gz`;
    const compressed = objects.get(segment);
    if (!compressed) throw new Error("Missing board log segment");
    const events = new TextDecoder()
      .decode(Bun.gunzipSync(Uint8Array.from(compressed)))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: number; type: string; payload: { text: string } });
    expect(events.map(({ id }) => id)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    expect(events.filter(({ type }) => type === "message.posted").map(({ payload }) => payload.text)).toEqual(texts);
    expect(objects.get(`${prefix}blobs/sha256/${hash}`)).toEqual(bytes);

    await clock.advance(start + 20_000);
    await clock.advance(start + sixHours);
    await Promise.all(snapshotWrites.map(({ promise }) => promise));
    const snapshots = writes.filter((key) => key.startsWith(`${prefix}snapshots/`));
    expect(snapshots).toEqual([
      `${prefix}snapshots/2026-01-01T00-00-00.000Z.sqlite`,
      `${prefix}snapshots/2026-01-01T06-00-00.000Z.sqlite`,
    ]);
    for (const key of snapshots) {
      expect(new TextDecoder().decode(objects.get(key)?.subarray(0, 16))).toBe("SQLite format 3\0");
    }
    expect(writes.sort()).toEqual(
      [...snapshots, segment, `${prefix}blobs/sha256/${hash}`, `${prefix}attachments/1/${attachment.id}.json`].sort(),
    );
    expect(errors).toEqual([]);
  });
});

test("local SQLite without backup variables logs once and ships nothing", async () => {
  await withBoard(false, async ({ app, bucketOpens, clock, messages, post, writes }) => {
    expect((await post("on disk")).status).toBe(201);
    await clock.advance(start + sixHours);
    await app.close();
    expect(bucketOpens).toBe(0);
    expect(writes).toEqual([]);
    expect(messages.filter((message) => message === "log shipping is off")).toEqual(["log shipping is off"]);
  });
});

test("local snapshot retries check the bucket and ship the retained pre-migration copy under a UTC key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openboard-backup-retry-"));
  try {
    const initial = await startBoard(dir, false);
    await initial.app.close();
    const backupDir = join(dir, "backups");
    const copy = join(backupDir, "pre-migrate-42.sqlite");
    await rename(join(backupDir, "2026-01-01T00-00-00.000Z.sqlite"), copy);
    const time = new Date(start - 1_000);
    await utimes(copy, time, time);
    const { app, clock, snapshotError, snapshotProbes, snapshotWrites, writes } = await startBoard(dir, true, true);
    try {
      await snapshotError;
      await clock.advance(start + 10_000);
      await Promise.all(snapshotWrites.map(({ promise }) => promise));
      expect(writes.sort()).toEqual([
        `${prefix}snapshots/2025-12-31T23-59-59.000000000Z.sqlite`,
        `${prefix}snapshots/2026-01-01T00-00-00.000Z.sqlite`,
      ]);
      for (const key of writes) expect(snapshotProbes.filter((probe) => probe === key)).toHaveLength(2);
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local shipping finds retained snapshots even if the startup copy fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openboard-backup-startup-"));
  try {
    const initial = await startBoard(dir, false);
    await initial.app.close();
    const backupDir = join(dir, "backups");
    const startup = join(backupDir, "2026-01-01T00-00-00.000Z.sqlite");
    const retained = "2025-12-31T18-00-00.000Z.sqlite";
    await rename(startup, join(backupDir, retained));
    await mkdir(startup);
    const { app, errors, snapshotWrites, writes } = await startBoard(dir, true);
    try {
      await snapshotWrites[0]?.promise;
      expect(errors).toEqual(["SQLite snapshot failed"]);
      expect(writes).toEqual([`${prefix}snapshots/${retained}`]);
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
