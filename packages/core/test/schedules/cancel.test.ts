import { expect, test } from "bun:test";
import { decideCancelSchedule, decideSchedule, resolveScheduleTiming } from "@openboard/core";

const now = 1_700_000_000_000;
const by = { actor: "ada", principal: "ada", profile: null };
const input = { channel: "work", text: "reminder", in: "1d" };
const { schedule } = decideSchedule({ head: 0, nextSchedule: 1, target: null }, input, {
  by,
  now,
  author: { kind: "person", name: "Ada", handle: "ada", avatar: null },
  timing: resolveScheduleTiming(input, now),
  blind: false,
  creator: {},
}).payload;

test("canceling a finished schedule leaves its last send and cancellation untouched", () => {
  const done = { ...schedule, state: "done", sent: 1, next: null, last: "3" } as const;
  const result = decideCancelSchedule(done, { head: 3, now, by });
  expect(result).toEqual({ schedule: done, event: null });
});
