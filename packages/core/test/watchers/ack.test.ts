import { expect, test } from "bun:test";
import { decideWatcherAck } from "../../src/watchers/ack.ts";

test.each([1_000, 2_000, 4_000, 8_000].map((delay, attempt) => ({ attempt, delay })))(
  "waits $delay ms after an error on attempt $attempt",
  ({ attempt, delay }) => {
    const now = 123_456;
    expect(decideWatcherAck(attempt, now, { error: "timeout" })).toEqual({
      kind: "retry",
      attempt: attempt + 1,
      nextAt: now + delay,
    });
  },
);

test("the fifth try fails and retains its error", () => {
  expect(decideWatcherAck(4, 123_456, { error: "timeout" })).toEqual({ kind: "failed", error: "timeout" });
});

test("skip takes precedence over error on the final try", () => {
  expect(decideWatcherAck(4, 123_456, { error: "timeout", skip: true })).toEqual({ kind: "drop" });
});
