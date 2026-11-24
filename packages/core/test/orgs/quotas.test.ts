import { expect, test } from "bun:test";
import {
  checkDailyEvents,
  checkStoredBytes,
  countQuotas,
  dailyEventsLimit,
  dailyEventWindow,
  storedBytesLimit,
} from "@openboard/core";

test("count quotas default to 10 boards, 50 members, and 100 connections per board", () => {
  expect(countQuotas()).toEqual({ boards: 10, members: 50, connections: 100, webhooks: 20 });
});

test("organization overrides replace only the limits they name, including zero", () => {
  expect(countQuotas({ boards: 12 })).toEqual({ boards: 12, members: 50, connections: 100, webhooks: 20 });
  expect(countQuotas({ members: 0, connections: 2 })).toEqual({ boards: 10, members: 0, connections: 2, webhooks: 20 });
  expect(countQuotas()).toEqual({ boards: 10, members: 50, connections: 100, webhooks: 20 });
});

test("the stored bytes quota allows exact fits and reductions, including when already over limit", () => {
  expect(storedBytesLimit({})).toBe(1_000_000_000);
  expect(storedBytesLimit({ storedBytes: 0 })).toBe(0);
  expect(() => checkStoredBytes(800, 200, 1000)).not.toThrow();
  expect(() => checkStoredBytes(1200, -100, 1000)).not.toThrow();
  expect(() => checkStoredBytes(800, 201, 1000)).toThrow(
    expect.objectContaining({
      code: "quota_exceeded",
      reason: "stored_bytes",
    }),
  );
});

test("daily events allow exact fits and report a rounded delay to the next UTC day", () => {
  expect(dailyEventsLimit({})).toBe(100_000);
  expect(dailyEventsLimit({ eventsPerBoardPerDay: 0 })).toBe(0);
  const midnight = 1_700_006_400_000 /* 2023-11-15T00:00:00Z */;
  const now = midnight - 2500;
  const { day, nextDay } = dailyEventWindow(now);
  expect(day).toBe(1_699_920_000_000 /* 2023-11-14T00:00:00Z */);
  expect(nextDay).toBe(midnight);
  expect(dailyEventWindow(midnight).day).toBe(midnight);
  expect(() => checkDailyEvents(4, 1, 5, nextDay, now)).not.toThrow();
  expect(() => checkDailyEvents(4, 2, 5, nextDay, now)).toThrow(
    expect.objectContaining({
      code: "quota_exceeded",
      reason: "daily_events",
      next: [{ kind: "wait", seconds: 3 }],
    }),
  );
});
