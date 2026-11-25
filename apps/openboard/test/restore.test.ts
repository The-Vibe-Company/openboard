import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Attachment } from "@openboard/contract";
import { compose } from "../src/compose.ts";
import { loadConfig } from "../src/config.ts";
import { restore } from "../src/restore.ts";
import { prefix, request, restoreClock, start, startBoard } from "./support/local-backup.ts";

async function withTemp(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "openboard-restore-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function fixture(run: (board: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  return withTemp(async (dir) => run(await seed(dir)));
}

async function seed(dir: string) {
  const original = join(dir, "original");
  const board = await startBoard(original);
  let attachment: Attachment;
  const bytes = Uint8Array.of(2, 4, 8);
  try {
    await board.clock.armed;
    await board.clock.advance(start);
    await board.snapshot;
    const upload = await board.send("attachments", bytes, {
      "content-type": "image/png",
      "x-board-filename": "test.png",
    });
    expect(upload.status).toBe(201);
    ({ attachment } = (await upload.json()) as { attachment: Attachment });
    await board.clock.advance(start + 1);
    expect((await board.post("first", [attachment.id])).status).toBe(201);
    await board.clock.advance(start + 10_000);
    expect((await board.post("second")).status).toBe(201);
    await board.clock.advance(start + 20_000);
    expect((await board.post("third")).status).toBe(201);
    await board.clock.advance(start + 30_000);
    expect(board.errors).toEqual([]);
    const orphan = await board.send("attachments", Uint8Array.of(9), {
      "content-type": "text/plain",
      "x-board-filename": "not-yet-shipped.txt",
    });
    expect(orphan.status).toBe(201);
  } finally {
    await board.app.close();
  }
  const name = "2026-01-01T00-00-00.000Z.sqlite";
  // Include an older valid snapshot to check selection independent of listing order.
  board.objects.set(
    `${prefix}snapshots/2025-12-31T23-59-59.000Z.sqlite`,
    await Bun.file(join(original, "backups", name)).bytes(),
  );
  return { ...board, dir, original, name, attachment, bytes };
}

async function command(board: Awaited<ReturnType<typeof seed>>, dir: string, args: string[] = [], local = false) {
  const lines: string[] = [];
  const output = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
  const config = local ? loadConfig({}) : board.config;
  const code = await restore(config, ["--to", dir, ...args], output, () => {
    if (local) throw new Error("Local restore opened the bucket");
    return board.bucket;
  });
  return { code, lines };
}

async function checkBoard(board: Awaited<ReturnType<typeof seed>>, dir: string, texts: string[]) {
  const app = await compose(loadConfig({ OPENBOARD_DATA_DIR: dir }), board.owner.hash);
  const get = (path: string) =>
    app.fetch(
      new Request(`${board.config.publicUrl}/api/local/main/${path}`, {
        headers: { authorization: `Bearer ${board.owner.token}` },
      }),
    );
  try {
    const response = await get("messages?channel=dev");
    expect(response.status).toBe(200);
    const { messages } = (await response.json()) as { messages: { text: string }[] };
    expect(messages.map(({ text }) => text)).toEqual(texts);
    if (texts.length === 0) return;
    const download = await get(`attachments/${board.attachment.id}`);
    expect(download.status).toBe(200);
    expect(await download.bytes()).toEqual(board.bytes);
  } finally {
    await app.close();
  }
}

test("restores the newest snapshot, every subsequent segment and downloadable attachments", () =>
  fixture(async (board) => {
    const dir = join(board.dir, "restored");
    expect(await command(board, dir)).toEqual({
      code: 0,
      lines: [`Restored ${prefix}snapshots/${board.name}; replayed 4 events`],
    });
    await checkBoard(board, dir, ["first", "second", "third"]);
    const db = join(dir, "board.db");
    const before = await readFile(db);
    expect(await command(board, dir)).toEqual({
      code: 2,
      lines: ["error: invalid_request: Restore destination already contains a database"],
    });
    expect(await readFile(db)).toEqual(before);
  }));

test("point-in-time replay excludes the event at the cutoff and accepts a legacy attachment mapping", () =>
  fixture(async (board) => {
    const dir = join(board.dir, "earlier");
    // The filename records when the snapshot started, which can precede the last row captured.
    board.objects.set(
      `${prefix}snapshots/2026-01-01T00-00-09.999Z.sqlite`,
      await Bun.file(join(board.original, "board.db")).bytes(),
    );
    const hash = Bun.CryptoHasher.hash("sha256", board.bytes, "hex");
    board.objects.set(
      `${prefix}attachments/1/${board.attachment.id}.json`,
      new TextEncoder().encode(JSON.stringify({ sha256: hash })),
    );
    expect((await command(board, dir, ["--at", new Date(start + 10_000).toISOString()])).code).toBe(0);
    await checkBoard(board, dir, ["first"]);
  }));

test("includes events before a sub-millisecond cutoff and repairs a corrupt destination blob", () =>
  fixture(async (board) => {
    const dir = join(board.dir, "repair");
    const content = join(dir, "blobs", "org", "1", "sha256");
    const hash = Bun.CryptoHasher.hash("sha256", board.bytes, "hex");
    await mkdir(content, { recursive: true });
    await writeFile(join(content, hash), "corrupt");
    expect((await command(board, dir, ["--at", "2026-01-01T00:00:00.0011Z"])).code).toBe(0);
    await checkBoard(board, dir, ["first"]);
  }));

test("uses an older snapshot when the newest snapshot contains an attachment that never reached the bucket", () =>
  fixture(async (board) => {
    const dir = join(board.dir, "fallback");
    board.objects.set(
      `${prefix}snapshots/2026-01-01T00-00-30.000Z.sqlite`,
      await Bun.file(join(board.original, "board.db")).bytes(),
    );
    expect(await command(board, dir)).toEqual({
      code: 0,
      lines: [`Restored ${prefix}snapshots/${board.name}; replayed 4 events`],
    });
    await checkBoard(board, dir, ["first", "second", "third"]);
  }));

test("names a missing middle segment and leaves the destination unpublished", () =>
  fixture(async (board) => {
    const dir = join(board.dir, "broken");
    expect(board.objects.delete(`${prefix}board/1/3-3.ndjson.gz`)).toBe(true);
    expect(await command(board, dir)).toEqual({
      code: 2,
      lines: [
        `error: invalid_request: Missing backup segment covering events 3-3 before ${prefix}board/1/4-4.ndjson.gz`,
      ],
    });
    expect(await Bun.file(join(dir, "board.db")).exists()).toBe(false);
  }));

test("restores a snapshot from the destination's own backups directory without the bucket", () =>
  fixture(async (board) => {
    const dir = join(board.dir, ".openboard");
    const backupDir = join(dir, "backups");
    const source = join(backupDir, board.name);
    await mkdir(backupDir, { recursive: true });
    await copyFile(join(board.original, "backups", board.name), source);
    expect(await command(board, dir, ["--from", source], true)).toEqual({
      code: 0,
      lines: [`Restored ${source}; replayed 0 events`],
    });
    await checkBoard(board, dir, []);
  }));

test("recovers an attachment referenced by a schedule that has not sent yet", () =>
  withTemp(async (dir) => {
    const board = await startBoard(join(dir, "original"));
    let attachment: Attachment;
    const bytes = Uint8Array.of(1, 2, 3);
    try {
      await board.clock.armed;
      await board.clock.advance(start);
      await board.snapshot;
      const upload = await board.send("attachments", bytes, {
        "content-type": "text/plain",
        "x-board-filename": "schedule.txt",
      });
      ({ attachment } = (await upload.json()) as { attachment: Attachment });
      const schedule = await board.send(
        "schedules",
        JSON.stringify({
          channel: "dev",
          text: "after restore",
          in: "60s",
          attachments: [attachment.id],
        }),
        { "content-type": "application/json" },
      );
      expect(schedule.status).toBe(201);
      await board.clock.advance(start + 10_000);
    } finally {
      await board.app.close();
    }
    const restored = join(dir, "restored");
    const lines: string[] = [];
    const recover = (destination: string) =>
      restore(
        board.config,
        ["--to", destination],
        {
          out: () => {},
          err: (line) => lines.push(line),
        },
        () => board.bucket,
      );
    const key = `${prefix}attachments/1/${attachment.id}.json`;
    const mapping = board.objects.get(key);
    if (!mapping) throw new Error("The scheduled attachment did not ship");
    board.objects.delete(key);
    expect(await recover(join(dir, "legacy"))).toBe(0);
    board.objects.set(key, mapping);
    expect(await recover(restored)).toBe(0);
    expect(lines).toEqual([]);
    const clock = restoreClock();
    await clock.advance(start + 60_000);
    const config = loadConfig({ OPENBOARD_DATA_DIR: restored });
    const app = await compose(config, board.owner.hash, {
      deps: { ...clock, log: { info() {}, error() {} } },
      backupBucket: () => board.bucket,
    });
    try {
      await clock.armed;
      await clock.advance(start + 60_000);
      const posts = await request(app, config.publicUrl, board.owner.token, "messages?channel=dev");
      expect(await posts.json()).toMatchObject({
        messages: [{ text: "after restore", attachments: [{ id: attachment.id }] }],
      });
      const download = await request(app, config.publicUrl, board.owner.token, `attachments/${attachment.id}`);
      expect(download.status).toBe(200);
      expect(await download.bytes()).toEqual(bytes);
    } finally {
      await app.close();
    }
  }));

test("ships a new history after point-in-time recovery into a bucket seeded with source attachments", () =>
  fixture(async (board) => {
    const dir = join(board.dir, "fork");
    expect((await command(board, dir, ["--at", new Date(start + 10_000).toISOString()])).code).toBe(0);
    const resumed = await startBoard(dir);
    try {
      for (const [key, bytes] of board.objects) {
        if (key.startsWith(`${prefix}blobs/`) || key.startsWith(`${prefix}attachments/`))
          resumed.objects.set(key, bytes);
      }
      await resumed.clock.armed;
      await resumed.clock.advance(start);
      await resumed.snapshot;
      await resumed.clock.advance(start + 2);
      expect((await resumed.post("new history")).status).toBe(201);
      await resumed.clock.advance(start + 10_000);
      expect(resumed.errors).toEqual([]);
    } finally {
      await resumed.app.close();
    }
    const restored = join(board.dir, "fork-restored");
    expect((await command({ ...board, bucket: resumed.bucket }, restored)).code).toBe(0);
    await checkBoard(board, restored, ["first", "new history"]);
  }));

test("restores an intact sparse range and keeps its logical head", () =>
  fixture(async (board) => {
    const dir = join(board.dir, "sparse");
    // Keep the last post at position 4 and represent compacted positions 5 and 6.
    const key = `${prefix}board/1/4-4.ndjson.gz`;
    const segment = board.objects.get(key);
    if (!segment) throw new Error("missing fixture segment");
    board.objects.delete(key);
    board.objects.set(`${prefix}board/1/4-6.ndjson.gz`, segment);
    expect((await command(board, dir)).code).toBe(0);
    await checkBoard(board, dir, ["first", "second", "third"]);
    const app = await compose(loadConfig({ OPENBOARD_DATA_DIR: dir }), board.owner.hash);
    try {
      const response = await request(app, board.config.publicUrl, board.owner.token, "events?all=true&after=4");
      expect(await response.json()).toEqual({ cursor: "6", events: [] });
    } finally {
      await app.close();
    }
  }));
