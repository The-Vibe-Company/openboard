import { expect, test } from "bun:test";
import { checkStoredBytes, countQuotas, storedBytesLimit } from "@openboard/core";

test("count quotas default to 10 boards, 50 members, and 100 connections per board", () => {
  expect(countQuotas()).toEqual({ boards: 10, members: 50, connections: 100 });
});

test("organization overrides replace only the limits they name, including zero", () => {
  expect(countQuotas({ boards: 12 })).toEqual({ boards: 12, members: 50, connections: 100 });
  expect(countQuotas({ members: 0, connections: 2 })).toEqual({ boards: 10, members: 0, connections: 2 });
  expect(countQuotas()).toEqual({ boards: 10, members: 50, connections: 100 });
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
