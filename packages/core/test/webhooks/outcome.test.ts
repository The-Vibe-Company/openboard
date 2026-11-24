import { expect, test } from "bun:test";
import { webhookOutcome, webhookRetryAt } from "@openboard/core";

const now = 1_700_000_000_000;

test("uses all nine backoff intervals for retryable statuses, network errors, and timeouts", () => {
  const statuses = [408, 425, 429, ...Array.from({ length: 100 }, (_, index) => 500 + index)];
  const failures = [
    ...statuses.map((status) => ({ status, error: null })),
    { status: null, error: "request_failed" },
    { status: null, error: "timeout" },
    { status: 200, error: "timeout" },
  ];
  for (const failure of failures) {
    const delays = [10, 30, 120, 600, 1_800, 3_600, 10_800, 21_600, 43_200];
    for (const [index, seconds] of delays.entries()) {
      expect(webhookRetryAt({ ...failure, attempt: index + 1, now })).toBe(now + seconds * 1_000);
    }
  }
});

test("uses a valid Retry-After in seconds or as an HTTP date up to an hour", () => {
  const retry = (retryAfter: string) => webhookRetryAt({ status: 429, error: null, attempt: 2, now, retryAfter });
  expect(retry("0")).toBe(now);
  expect(retry("3600")).toBe(now + 3_600_000);
  expect(retry("Tue, 14 Nov 2023 22:13:37 GMT")).toBe(now + 17_000);
  for (const ignored of ["3601", "-1", "1.5", "tomorrow", "Tue, 14 Nov 2023 22:13:19 GMT"]) {
    expect(retry(ignored)).toBe(now + 30_000);
  }
});

test("treats other 4xx and request construction failures as terminal and 2xx as done", () => {
  for (let status = 400; status < 500; status++) {
    if ([408, 425, 429].includes(status)) continue;
    expect(webhookRetryAt({ status, error: null, attempt: 1, now, retryAfter: "5" })).toBeNull();
    expect(webhookRetryAt({ status, error: "timeout", attempt: 1, now })).toBeNull();
    expect(webhookOutcome(status)).toEqual({ state: "dead", status, gone: status === 410 });
  }
  expect(webhookRetryAt({ status: null, error: "invalid_url", attempt: 1, now })).toBeNull();
  for (let status = 200; status < 300; status++) {
    expect(webhookRetryAt({ status, error: null, attempt: 1, now })).toBeNull();
    expect(webhookOutcome(status)).toEqual({ state: "done", status, gone: false });
  }
});
