import { exportEvent } from "@openboard/core";
import type { Bucket, ExportSource } from "@openboard/ports";

const encoder = new TextEncoder();
const segmentPattern = /^(\d+)-(\d+)\.ndjson\.gz$/;

function tarHeader(path: string, size: number) {
  const header = new Uint8Array(512);
  const write = (offset: number, value: string) => header.set(encoder.encode(value), offset);
  write(0, path);
  write(100, "0000600");
  write(108, "0000000");
  write(116, "0000000");
  write(124, size.toString(8).padStart(11, "0"));
  write(136, "00000000000");
  write(148, "        ");
  write(156, "0");
  write(257, "ustar\0" + "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  write(148, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function* entry(path: string, contents: Uint8Array<ArrayBuffer>) {
  yield tarHeader(path, contents.length);
  yield contents;
  const padding = (512 - (contents.length % 512)) % 512;
  if (padding) yield new Uint8Array(padding);
}

function* eventSegment(dir: string, first: number, last: number, events: readonly object[]) {
  if (first > last) return;
  const lines = events.map((event) => `${JSON.stringify(exportEvent(event))}\n`).join("");
  yield* entry(`${dir}/${first}-${last}.ndjson.gz`, Bun.gzipSync(encoder.encode(lines)));
}

async function* logs(
  bucket: Bucket,
  prefix: string,
  source: ExportSource,
  dir: string,
  board: number,
  head: number,
  shipped: number,
) {
  let after = 0;
  async function* database(through: number) {
    while (after < through) {
      const events = await source.events(board, after, through);
      const last = events.at(-1)?.id;
      if (last === undefined) {
        if (board !== 0) yield* eventSegment(dir, after + 1, through, []);
        break;
      }
      yield* eventSegment(dir, after + 1, last, events);
      after = last;
    }
    after = through;
  }

  const directory = `${prefix}${dir}/`;
  const segments = [];
  if (shipped) {
    for await (const key of bucket.list(directory)) {
      const match = segmentPattern.exec(key.slice(directory.length));
      if (!key.startsWith(directory) || !match) continue;
      const first = Number(match[1]);
      const last = Number(match[2]);
      if (first <= last && last <= shipped && last <= head) segments.push({ key, first, last });
    }
  }
  for (const { key, first, last } of segments.sort((a, b) => a.first - b.first || b.last - a.last)) {
    if (first <= after) continue;
    const contents = await bucket.read(key);
    if (!contents) continue;
    const compressed = await new Response(contents).blob();
    const decoded = await new Response(compressed.stream().pipeThrough(new DecompressionStream("gzip"))).bytes();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
    if (text && !text.endsWith("\n")) throw new Error("Incomplete exported log segment");
    const events =
      text === ""
        ? []
        : text
            .slice(0, -1)
            .split("\n")
            .map((line) => {
              const { org_id: _orgId, board_id: _boardId, ...event } = JSON.parse(line) as Record<string, unknown>;
              return event;
            });
    yield* database(first - 1);
    yield* eventSegment(dir, first, last, events);
    after = last;
  }
  yield* database(head);
}

async function* archive(bucket: Bucket, prefix: string, source: ExportSource) {
  const manifest = {
    version: 1,
    organization: { ...source.organization, head: source.log.head },
    members: source.members,
    boards: source.boards.map(({ shipped: _shipped, ...board }) => board),
    connections: source.connections,
    attachments: "not yet supported",
    accessPolicy: "recreate",
  };
  yield* entry("manifest.json", encoder.encode(JSON.stringify(manifest)));
  yield* logs(bucket, prefix, source, "log", 0, source.log.head, source.log.shipped);
  for (const board of source.boards) {
    yield* logs(bucket, prefix, source, `board/${board.id}`, board.id, board.head, board.shipped);
  }
  yield new Uint8Array(1024);
}

export function exportArchive(bucket: Bucket, prefix: string, source: ExportSource) {
  const iterator = archive(bucket, prefix, source);
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      const step = await iterator.next();
      if (step.done) controller.close();
      else controller.enqueue(step.value);
    },
    async cancel() {
      await iterator.return(undefined);
    },
  }).pipeThrough(new CompressionStream("gzip"));
}
