import { expect, test } from "bun:test";
import { nextScheduleTime, parseScheduleId, resolveScheduleTiming } from "@openboard/core";

test("schedule times use the supplied clock and honor UTC offsets", () => {
  const now = 1_795_478_400_000;
  expect(resolveScheduleTiming({ in: "1d" }, now).firstAt).toBe(now + 86_400_000);
  expect(resolveScheduleTiming({ in: "1.5h" }, now).firstAt).toBe(now + 5_400_000);
  expect(resolveScheduleTiming({ at: "2026-11-24T03:30:00+02:00" }, now).firstAt).toBe(now + 5_400_000);
  expect(() => resolveScheduleTiming({ at: "2026-11-31T00:00:00Z" }, now)).toThrow("ISO time");
  expect(() => resolveScheduleTiming({ at: "2026-11-24T03:30:00" }, now)).toThrow("UTC offset");
  expect(() => resolveScheduleTiming({ in: "367d" }, now)).toThrow("at most a year");
});

test("schedule IDs accept both prefixed and bare refs", () => {
  expect(parseScheduleId("12")).toBe(12);
  expect(parseScheduleId("s12")).toBe(12);
  for (const text of ["s0", "-12", "s012", "s1e2"]) expect(parseScheduleId(text)).toBeNull();
});

const minute = 60_000;
const now = 1_700_000_000_000;

test("a three-send repeat advances one slot at a time and a one-off ends", () => {
  const repeat = resolveScheduleTiming({ every: "1m", at: "2023-11-14T22:13:20Z", times: 3 }, now);
  const { firstAt } = repeat;
  expect(firstAt).toBe(now);
  expect(nextScheduleTime(repeat, firstAt, 1)).toBe(now + minute);
  expect(nextScheduleTime(repeat, firstAt + minute, 2)).toBe(now + 2 * minute);
  expect(nextScheduleTime(repeat, firstAt + 2 * minute, 3)).toBeNull();
  const once = resolveScheduleTiming({ in: "1m" }, now);
  expect(nextScheduleTime(once, once.firstAt, 1)).toBeNull();
});

test("time-limited repeats include the last slot on or before the stop", () => {
  for (const stop of [{ for: "2m" }, { until: "2023-11-14T22:16:45Z" }]) {
    const repeat = resolveScheduleTiming({ every: "1m", ...stop }, now);
    const { firstAt } = repeat;
    expect(firstAt).toBe(now + minute);
    expect(nextScheduleTime(repeat, firstAt + minute, 2)).toBe(firstAt + 2 * minute);
    expect(nextScheduleTime(repeat, firstAt + 2 * minute, 3)).toBeNull();
  }
  const justBeforeSecond = resolveScheduleTiming({ every: "1m", for: "59.9999s" }, now);
  expect(nextScheduleTime(justBeforeSecond, justBeforeSecond.firstAt, 1)).toBeNull();

  expect(() => resolveScheduleTiming({ every: "1m", until: "2023-11-14T22:13:20Z" }, now)).toThrow(
    "stops before its first send",
  );
});

test("repeat interval, first send, and time-based stop may reach at most a year out", () => {
  const edge = now + 366 * 86_400_000;
  expect(resolveScheduleTiming({ every: "366d" }, now).firstAt).toBe(edge);
  expect(resolveScheduleTiming({ every: "1m", for: "365d" }, now).untilAt).toBeLessThan(edge);
  expect(() => resolveScheduleTiming({ every: "367d", in: "1m" }, now)).toThrow("every: at most a year");
  expect(() => resolveScheduleTiming({ every: "1m", in: "367d" }, now)).toThrow("at most a year out");
  expect(() => resolveScheduleTiming({ every: "1m", for: "366d" }, now)).toThrow("at most a year out");
  expect(() => resolveScheduleTiming({ every: "1m", until: "2024-11-15T22:13:21Z" }, now)).toThrow(
    "at most a year out",
  );
});
