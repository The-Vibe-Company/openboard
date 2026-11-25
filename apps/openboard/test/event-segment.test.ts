import { expect, test } from "bun:test";
import { decodeEventSegment } from "../src/event-segment.ts";

function gzip(text: string) {
  return Uint8Array.from(Bun.gzipSync(new TextEncoder().encode(text)));
}

function event(id: number) {
  return JSON.stringify({ id, at: 1, v: 1 });
}

test("checks sparse segment ordering, logical bounds, framing and the gzip trailer", () => {
  const first = event(1);
  const third = event(3);
  const intact = gzip(`${first}\n${third}\n`);
  expect(decodeEventSegment(intact.buffer, 1, 4).map(({ id }) => id)).toEqual([1, 3]);
  expect(decodeEventSegment(gzip("").buffer, 1, 4)).toEqual([]);
  for (const text of [`${first}\n${first}\n`, `${third}\n${first}\n`, `${event(0)}\n`, `${event(5)}\n`, third]) {
    expect(() => decodeEventSegment(gzip(text).buffer, 1, 4)).toThrow();
  }
  expect(() => decodeEventSegment(intact.slice(0, -1).buffer, 1, 4)).toThrow();
  const extra = gzip(`${event(4)}\n`);
  const truncatedMember = Uint8Array.from([...intact, ...extra.slice(0, -1)]);
  expect(() => decodeEventSegment(truncatedMember.buffer, 1, 4)).toThrow();
  const crc = intact.length - 8;
  intact[crc] = (intact[crc] ?? 0) ^ 1;
  expect(() => decodeEventSegment(intact.buffer, 1, 4)).toThrow();
});
