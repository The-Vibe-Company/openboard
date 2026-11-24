import { expect, test } from "bun:test";
import budgets from "../budgets.json";
import { compareBudgets } from "../src/compare";
import type { ModeReport } from "../src/counters";

const localReport: ModeReport = {
  mode: "local",
  idleTimers: 0,
  workloads: [
    { workload: "post", operation: "postMessage", runs: 1, statements: 9, roundTrips: 0, p50: 0.1, p99: 0.2 },
    { workload: "reply", operation: "postMessage", runs: 1, statements: 11, roundTrips: 0, p50: 0.1, p99: 0.2 },
    { workload: "channelRead", operation: "listMessages", runs: 1, statements: 2, roundTrips: 0, p50: 0.1, p99: 0.2 },
  ],
};

const all = { latency: true };

test("equal and lower counters pass within the measured budgets", () => {
  expect(compareBudgets(localReport, all)).toEqual([]);
});

test("a statement increase identifies the operation, workload and both counts", () => {
  const workloads = localReport.workloads.map((row) =>
    row.workload === "post" ? { ...row, statements: row.statements + 1 } : row,
  );
  expect(compareBudgets({ ...localReport, workloads }, all)).toEqual(["local postMessage (post) statements: 9 -> 10"]);
});

test("an idle timer increase identifies both counts", () => {
  expect(compareBudgets({ ...localReport, idleTimers: 1 }, all)).toEqual(["local timers armed when idle: 0 -> 1"]);
});

test("hosted is held to its own budget", () => {
  const hosted = { post: 11, reply: 15, channelRead: 4 };
  const trips = { post: 12, reply: 14, channelRead: 4 };
  const workloads = localReport.workloads.map((row) => ({
    ...row,
    statements: hosted[row.workload],
    roundTrips: trips[row.workload],
  }));
  expect(compareBudgets({ mode: "hosted", workloads, idleTimers: 1 }, all)).toEqual([
    "hosted postMessage (post) round trips: 11 -> 12",
    "hosted postMessage (reply) statements: 14 -> 15",
    "hosted timers armed when idle: 0 -> 1",
  ]);
});

test("a measured write exactly 20% over budget passes", () => {
  const workloads = localReport.workloads.map((row) =>
    row.workload === "post" ? { ...row, p50: 0.156, p99: 0.336 } : row,
  );
  expect(compareBudgets({ ...localReport, workloads }, all)).toEqual([]);
});

test("a write more than 20% but within the noise floor (0.5 ms at p50, 1 ms at p99) passes", () => {
  const workloads = localReport.workloads.map((row) =>
    row.workload === "post" ? { ...row, p50: 0.63, p99: 1.28 } : row,
  );
  expect(compareBudgets({ ...localReport, workloads }, all)).toEqual([]);
});

test("measured writes over budget by more than 20% and the noise floor name their percentile, value and budget", () => {
  const workloads = localReport.workloads.map((row) =>
    row.workload === "post" ? { ...row, p50: 0.631, p99: 1.281 } : row,
  );
  expect(compareBudgets({ ...localReport, workloads }, all)).toEqual([
    "local postMessage (post) p50: 0.631 ms exceeds budget 0.13 ms by more than 20% and 0.5 ms",
    "local postMessage (post) p99: 1.281 ms exceeds budget 0.28 ms by more than 20% and 1 ms",
  ]);
});

test("without latency, only the counters are held", () => {
  const workloads = localReport.workloads.map((row) =>
    row.workload === "post" ? { ...row, statements: 10, p50: 9, p99: 99 } : row,
  );
  expect(compareBudgets({ ...localReport, workloads }, { latency: false })).toEqual([
    "local postMessage (post) statements: 9 -> 10",
  ]);
});

test("local SSE fan-out uses the measured budget and noise floor", () => {
  const { p50Ms, p99Ms } = budgets.local.sseFanOut;
  const sse = { tails: 50, events: 1000, p50: p50Ms, p99: p99Ms * 1.2 };
  expect(compareBudgets({ ...localReport, sse }, all)).toEqual([]);

  // Over both thresholds: 20% above the budget and more than the 1 ms noise floor above it.
  const over = Math.ceil(p99Ms * 1.2 + 1);
  expect(compareBudgets({ ...localReport, sse: { ...sse, p99: over } }, all)).toEqual([
    `local SSE fan-out p99: ${over} ms exceeds budget ${p99Ms} ms by more than 20% and 1 ms`,
  ]);
});
