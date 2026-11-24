import { expect, test } from "bun:test";
import { compareBudgets } from "../src/compare";
import type { ModeReport } from "../src/counters";

const localReport: ModeReport = {
  mode: "local",
  idleTimers: 0,
  workloads: [
    { workload: "post", operation: "postMessage", runs: 1, statements: 9, p50: 0.1, p99: 0.2 },
    { workload: "reply", operation: "postMessage", runs: 1, statements: 11, p50: 0.1, p99: 0.2 },
    { workload: "channelRead", operation: "listMessages", runs: 1, statements: 2, p50: 0.1, p99: 0.2 },
  ],
};

test("equal and lower counters pass within the measured budgets", () => {
  expect(compareBudgets(localReport)).toEqual([]);
});

test("a statement increase identifies the operation, workload and both counts", () => {
  const workloads = localReport.workloads.map((row) =>
    row.workload === "post" ? { ...row, statements: row.statements + 1 } : row,
  );
  expect(compareBudgets({ ...localReport, workloads })).toEqual(["local postMessage (post) statements: 9 -> 10"]);
});

test("an idle timer increase identifies both counts", () => {
  expect(compareBudgets({ ...localReport, idleTimers: 1 })).toEqual(["local timers armed when idle: 0 -> 1"]);
});

test("a mode without a recorded budget has no budget failures", () => {
  expect(compareBudgets({ mode: "hosted", workloads: [], idleTimers: 1 })).toEqual([]);
});

test("a measured write exactly 20% over budget passes", () => {
  const workloads = localReport.workloads.map((row) =>
    row.workload === "post" ? { ...row, p50: 0.156, p99: 0.336 } : row,
  );
  expect(compareBudgets({ ...localReport, workloads })).toEqual([]);
});

test("a write more than 20% but within the noise floor (0.5 ms at p50, 1 ms at p99) passes", () => {
  const workloads = localReport.workloads.map((row) =>
    row.workload === "post" ? { ...row, p50: 0.63, p99: 1.28 } : row,
  );
  expect(compareBudgets({ ...localReport, workloads })).toEqual([]);
});

test("measured writes over budget by more than 20% and the noise floor name their percentile, value and budget", () => {
  const workloads = localReport.workloads.map((row) =>
    row.workload === "post" ? { ...row, p50: 0.631, p99: 1.281 } : row,
  );
  expect(compareBudgets({ ...localReport, workloads })).toEqual([
    "local postMessage (post) p50: 0.631 ms exceeds budget 0.13 ms by more than 20% and 0.5 ms",
    "local postMessage (post) p99: 1.281 ms exceeds budget 0.28 ms by more than 20% and 1 ms",
  ]);
});
