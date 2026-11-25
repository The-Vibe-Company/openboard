import { expect, test } from "bun:test";
import { firstScheduleTime, parseScheduleId } from "@openboard/core";

test("schedule times use the supplied clock and honor UTC offsets", () => {
  const now = 1_795_478_400_000;
  expect(firstScheduleTime({ in: "1d" }, now)).toBe(now + 86_400_000);
  expect(firstScheduleTime({ in: "1.5h" }, now)).toBe(now + 5_400_000);
  expect(firstScheduleTime({ at: "2026-11-24T03:30:00+02:00" }, now)).toBe(now + 5_400_000);
  expect(() => firstScheduleTime({ at: "2026-11-31T00:00:00Z" }, now)).toThrow("ISO time");
  expect(() => firstScheduleTime({ at: "2026-11-24T03:30:00" }, now)).toThrow("UTC offset");
  expect(() => firstScheduleTime({ in: "367d" }, now)).toThrow("at most a year");
});

test("schedule IDs accept both prefixed and bare refs", () => {
  expect(parseScheduleId("12")).toBe(12);
  expect(parseScheduleId("s12")).toBe(12);
  for (const text of ["s0", "-12", "s012", "s1e2"]) expect(parseScheduleId(text)).toBeNull();
});
