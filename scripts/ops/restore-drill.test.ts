import { expect, test } from "bun:test";
import { measure } from "./restore-drill.ts";

test("counts the recovered event by ID and content and permits a loss exactly 10 seconds old", () => {
  const acks = [
    { id: "2", text: "first", at: 1_000 },
    { id: "3", text: "second", at: 2_000 },
    { id: "4", text: "third", at: 11_000 },
  ];
  const recovered = new Map([
    ["2", "first"],
    ["4", "other write at the same position"],
  ]);
  expect(measure(acks, recovered, 12_000)).toEqual({ restored: 1, lost: 2, oldestLoss: 10_000, passed: true });
  expect(measure(acks, recovered, 12_001)).toEqual({ restored: 1, lost: 2, oldestLoss: 10_001, passed: false });
});

test("reports zero loss when all acknowledged events survived", () => {
  const acks = [{ id: "2", text: "first", at: 1_000 }];
  expect(measure(acks, new Map([["2", "first"]]), 12_000)).toEqual({
    restored: 1,
    lost: 0,
    oldestLoss: 0,
    passed: true,
  });
});
