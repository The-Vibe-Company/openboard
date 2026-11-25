import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { decodeEventSegment } from "./event-segment.ts";

const block = 512;
const decoder = new TextDecoder("utf-8", { fatal: true });

type ArchiveEntries = ReadonlyMap<string, Blob>;

function octal(value: Uint8Array) {
  const text = decoder.decode(value).replace(/\0.*$/, "").trim();
  return /^[0-7]+$/.test(text) ? Number.parseInt(text, 8) : NaN;
}

async function indexTar(tar: ReturnType<typeof Bun.file>) {
  const entries = new Map<string, Blob>();
  let offset = 0;
  while (offset + block <= tar.size) {
    const header = await tar.slice(offset, offset + block).bytes();
    if (header.every((byte) => byte === 0)) {
      const end = await tar.slice(offset + block, offset + 2 * block).bytes();
      if (end.length === block && end.every((byte) => byte === 0)) return entries;
      break;
    }
    const path = decoder.decode(header.subarray(0, 100)).split("\0", 1)[0] ?? "";
    const size = octal(header.subarray(124, 136));
    const expected = octal(header.subarray(148, 156));
    header.fill(32, 148, 156);
    const start = offset + block;
    offset = start + Math.ceil(size / block) * block;
    if (
      !path ||
      entries.has(path) ||
      (header[156] !== 0 && header[156] !== 48) ||
      !Number.isSafeInteger(size) ||
      offset > tar.size ||
      header.reduce((sum, byte) => sum + byte, 0) !== expected
    ) {
      throw new Error(`Invalid or truncated archive entry ${JSON.stringify(path)}`);
    }
    entries.set(path, tar.slice(start, start + size));
  }
  throw new Error("Missing tar end marker");
}

/** Spool the gzip stream to disk so replay needs only one segment in memory. No archive paths are extracted. */
export async function withImportArchive<T>(path: string, run: (entries: ArchiveEntries) => Promise<T>) {
  const scratch = await mkdtemp(join(tmpdir(), "openboard-import-"));
  try {
    const tar = join(scratch, "archive.tar");
    let entries: ArchiveEntries;
    try {
      const stream = Bun.file(path).stream().pipeThrough(new DecompressionStream("gzip"));
      await Bun.write(tar, stream);
      entries = await indexTar(Bun.file(tar));
    } catch (error) {
      const detail =
        error instanceof Error && /^(Invalid or truncated archive entry|Missing tar end marker)/.test(error.message)
          ? `: ${error.message}`
          : "";
      throw new Error(`Could not read archive ${JSON.stringify(basename(path))}${detail}`, { cause: error });
    }
    return await run(entries);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function* readBoardEvents(entries: ArchiveEntries, board: { id: number; head: number }) {
  const prefix = `board/${board.id}/`;
  const segments = [...entries.keys()]
    .filter((path) => path.startsWith(prefix))
    .map((path) => {
      const match = /^(\d+)-(\d+)\.ndjson\.gz$/.exec(path.slice(prefix.length));
      if (!match) throw new Error(`Invalid event segment ${JSON.stringify(path)}`);
      return { path, first: Number(match[1]), last: Number(match[2]) };
    })
    .sort((a, b) => a.first - b.first);
  let head = 0;
  for (const { path, first, last } of segments) {
    try {
      if (first !== head + 1 || !Number.isSafeInteger(last) || last < first || last > board.head)
        throw new Error("Unexpected event range");
      const entry = entries.get(path);
      if (!entry) throw new Error("Missing segment");
      const events = decodeEventSegment(await entry.arrayBuffer(), first, last);
      head = last;
      yield { path, events, through: last };
    } catch (cause) {
      throw new Error(`Invalid or truncated event segment ${path}`, { cause });
    }
  }
  if (head !== board.head) throw new Error(`Missing event ${head + 1} in ${prefix} (manifest.json)`);
}
