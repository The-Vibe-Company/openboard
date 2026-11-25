import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Attachment } from "@openboard/contract";
import { compose } from "../src/compose.ts";
import { loadConfig } from "../src/config.ts";
import { importOrganization } from "../src/import.ts";
import { prefix, request, start, startBoard } from "./support/local-backup.ts";

const bytes = Uint8Array.of(2, 4, 8);
const jsonHeaders = { "content-type": "application/json" };

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "openboard-import-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function manifest(head = 0) {
  return {
    version: 1,
    organization: { slug: "acme", name: "Acme", head: 0 },
    boards: [
      { id: 23, slug: "main", head },
      { id: 42, slug: "ops", head: 0 },
    ],
    connections: [{ board: 23, name: "build-bot", recreate: true }],
    accessPolicy: "recreate",
    attachments: "not yet supported",
  };
}

async function archive(dir: string, value: ReturnType<typeof manifest>, files: Record<string, Uint8Array> = {}) {
  const path = join(dir, "acme.tar.gz");
  await Bun.write(
    path,
    await new Bun.Archive(
      { "manifest.json": JSON.stringify(value), ...files },
      {
        compress: "gzip",
      },
    ).blob(),
  );
  return path;
}

async function command(path: string, to: string, ...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await importOrganization([path, "--to", to, ...args], {
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
  });
  return { code, stdout, stderr };
}

async function views(board: Awaited<ReturnType<typeof startBoard>>, app: typeof board.app) {
  const get = (path: string) => request(app, board.config.publicUrl, board.owner.token, path);
  const result: unknown[] = [];
  for (const path of ["messages?channel=dev", "messages/2", "tasks?channel=dev", "channels", "threads?channel=dev"]) {
    const response = await get(path);
    expect(response.status, path).toBe(200);
    result.push(await response.json());
  }
  return result;
}

async function seed(dir: string, claim = false) {
  const board = await startBoard(dir);
  try {
    await board.clock.armed;
    await board.clock.advance(start);
    const upload = await board.send("attachments", bytes, {
      "content-type": "image/png",
      "x-board-filename": "test.png",
    });
    expect(upload.status).toBe(201);
    const { attachment } = (await upload.json()) as { attachment: Attachment };
    const task = await board.send(
      "tasks",
      JSON.stringify({
        channel: "dev",
        text: "first",
        labels: { stage: "review" },
        attachments: [attachment.id],
        claim,
      }),
      jsonHeaders,
    );
    expect(task.status).toBe(201);
    if (claim) {
      const { claim } = (await task.json()) as { claim: { epoch: number; token: string } };
      const released = await board.send(
        "tasks/2/release",
        JSON.stringify({ epoch: claim.epoch, token: claim.token }),
        jsonHeaders,
      );
      expect(released.status).toBe(200);
    }
    expect((await board.send("messages", JSON.stringify({ re: "2", text: "reply" }), jsonHeaders)).status).toBe(201);
    const expected = await views(board, board.app);
    await board.clock.advance(start + 10_000);
    const files = Object.fromEntries(
      [...board.objects].flatMap(([key, value]) => {
        const name = key.slice(prefix.length);
        return /^(board|attachments|blobs)\//.test(name)
          ? [[name.replace(/^(board|attachments)\/1\//, "$1/23/"), value]]
          : [];
      }),
    );
    return { board, attachment, files, expected };
  } finally {
    await board.app.close();
  }
}

test("replays message, author, label, task and attachment folds under local/main", () =>
  fixture(async (dir) => {
    const { board, attachment, files, expected } = await seed(join(dir, "source"));
    const path = await archive(dir, { ...manifest(4), attachments: "included" }, files);
    const target = join(dir, "imported");
    await mkdir(target);
    expect(await command(path, target)).toEqual({
      code: 0,
      stdout: [
        "Imported main as local/main (4 events, 1 files)",
        "Boards left out: ops",
        "Connection main/build-bot was not imported. To recreate it on its board: ob connections create build-bot --can '<pattern=permissions>' --secret-file '<path>'",
      ],
      stderr: [],
    });
    const imported = await compose(loadConfig({ OPENBOARD_DATA_DIR: target }), board.owner.hash);
    try {
      expect(await views(board, imported)).toEqual(expected);
      const download = await request(
        imported,
        board.config.publicUrl,
        board.owner.token,
        `attachments/${attachment.id}`,
      );
      expect(download.status).toBe(200);
      expect(await download.bytes()).toEqual(bytes);
    } finally {
      await imported.close();
    }
    const ops = await command(path, join(dir, "ops"), "--board", "ops");
    expect(ops.code).toBe(0);
    expect(ops.stdout.slice(0, 2)).toEqual(["Imported ops as local/main (0 events, 0 files)", "Boards left out: main"]);
  }));

test("rejects an existing database before reading the archive and leaves the directory untouched", () =>
  fixture(async (dir) => {
    const db = join(dir, "board.db");
    await writeFile(db, "existing board");
    const before = await stat(db);
    const result = await command(join(dir, "missing.tar.gz"), dir);
    expect(result.code).toBe(2);
    expect(result.stderr).toEqual(["error: invalid_request: Restore destination already contains a database"]);
    expect(await readdir(dir)).toEqual(["board.db"]);
    expect(await Bun.file(db).text()).toBe("existing board");
    expect((await stat(db)).mtimeMs).toBe(before.mtimeMs);
  }));

test("names manifest.json for an unsupported archive version", () =>
  fixture(async (dir) => {
    const path = await archive(dir, { ...manifest(), version: 99 });
    const target = join(dir, "imported");
    const result = await command(path, target);
    expect(result.code).toBe(1);
    expect(result.stderr).toEqual(["error: invalid_request: Unsupported version in manifest.json"]);
    expect(await readdir(dir)).toEqual(["acme.tar.gz"]);
  }));

test("names a truncated event segment without publishing a database", () =>
  fixture(async (dir) => {
    const path = await archive(dir, manifest(1), { "board/23/1-1.ndjson.gz": Uint8Array.of(31, 139, 8) });
    const result = await command(path, join(dir, "imported"));
    expect(result.code).toBe(1);
    expect(result.stderr).toEqual([
      "error: invalid_request: Invalid or truncated event segment board/23/1-1.ndjson.gz",
    ]);
    expect(await readdir(dir)).toEqual(["acme.tar.gz"]);
  }));

test("imports the current export format with a redacted historical claim and missing attachment bytes", () =>
  fixture(async (dir) => {
    const { board, files, expected } = await seed(join(dir, "source"), true);
    const entry = Object.entries(files).find(([name]) => name.startsWith("board/23/"));
    if (!entry) throw new Error("Expected shipped segment");
    const [name, contents] = entry;
    const events = new TextDecoder()
      .decode(Bun.gunzipSync(contents.slice()))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    const claimed = events.find((event) => event.type === "task.claimed");
    expect(claimed).toBeDefined();
    delete claimed.payload.tokenHash;
    const segment = Bun.gzipSync(
      new TextEncoder().encode(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`),
    );
    const path = await archive(dir, manifest(events.length), { [name]: segment });
    const target = join(dir, "imported");
    const result = await command(path, target);
    expect(result.stderr).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("This export does not include attachment bytes.");
    const app = await compose(loadConfig({ OPENBOARD_DATA_DIR: target }), board.owner.hash);
    try {
      expect(await views(board, app)).toEqual(expected);
    } finally {
      await app.close();
    }
  }));

test("rejects validly hashed bytes whose length disagrees with the event", () =>
  fixture(async (dir) => {
    const { attachment, files } = await seed(join(dir, "source"));
    const replacement = Uint8Array.of(0);
    const sha256 = Bun.CryptoHasher.hash("sha256", replacement, "hex");
    const file = `blobs/sha256/${sha256}`;
    const map = `attachments/23/${attachment.id}.json`;
    files[map] = new TextEncoder().encode(JSON.stringify({ sha256 }));
    files[file] = replacement;
    const path = await archive(dir, { ...manifest(4), attachments: "included" }, files);
    const result = await command(path, join(dir, "imported"));
    expect(result.code).toBe(1);
    expect(result.stderr).toEqual([`error: invalid_request: Incorrect attachment size in ${file}`]);
    expect((await readdir(dir)).sort()).toEqual(["acme.tar.gz", "source"]);
  }));

test("imports an intact sparse archive and preserves its logical head", () =>
  fixture(async (dir) => {
    const { board, files } = await seed(join(dir, "source"));
    const name = Object.keys(files).find((key) => key.startsWith("board/23/"));
    const segment = name === undefined ? undefined : files[name];
    if (!name || !segment) throw new Error("missing fixture segment");
    const head = Number(/-(\d+)\.ndjson\.gz$/.exec(name)?.[1]);
    const sparse = { ...files };
    delete sparse[name];
    sparse[`board/23/1-${head + 2}.ndjson.gz`] = segment;
    const path = await archive(dir, manifest(head + 2), sparse);
    const to = join(dir, "imported");
    expect((await command(path, to)).code).toBe(0);
    const app = await compose(loadConfig({ OPENBOARD_DATA_DIR: to }), board.owner.hash);
    try {
      const response = await request(app, board.config.publicUrl, board.owner.token, `events?all=true&after=${head}`);
      expect(await response.json()).toEqual({ cursor: String(head + 2), events: [] });
    } finally {
      await app.close();
    }
  }));
