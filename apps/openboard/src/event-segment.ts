import { gunzipSync } from "node:zlib";

export interface SegmentEvent {
  id: number;
  at: number;
  v: number;
}

/** The gzip checksum covers the bytes; the filename covers logical positions, including compacted ones. */
export function decodeEventSegment(bytes: ArrayBuffer, first: number, last: number): SegmentEvent[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(gunzipSync(new Uint8Array(bytes)));
  if (text === "") return [];
  if (!text.endsWith("\n")) throw new Error("Incomplete NDJSON line");
  let previous = first - 1;
  return text
    .slice(0, -1)
    .split("\n")
    .map((line) => {
      const event = JSON.parse(line) as SegmentEvent;
      if (
        !Number.isSafeInteger(event?.id) ||
        event.id <= previous ||
        event.id > last ||
        !Number.isSafeInteger(event.at) ||
        event.v !== 1
      )
        throw new Error("Unexpected event sequence or version");
      previous = event.id;
      return event;
    });
}
