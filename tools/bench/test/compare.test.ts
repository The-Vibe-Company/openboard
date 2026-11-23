import { expect, test } from "bun:test";
import { compareCounters } from "../src/compare";
import type { ModeReport } from "../src/counters";

const localReport: ModeReport = {
  mode: "local",
  idleTimers: 0,
  workloads: [
    { workload: "post", operation: "postMessage", runs: 1, statements: 9, p50: 1, p99: 1 },
    { workload: "reply", operation: "postMessage", runs: 1, statements: 11, p50: 1, p99: 1 },
    { workload: "channelRead", operation: "listMessages", runs: 1, statements: 2, p50: 1, p99: 1 },
  ],
};

test("equal and lower counters pass regardless of measured latency", () => {
  expect(compareCounters(localReport)).toEqual([]);
});

test("a statement increase identifies the operation, workload and both counts", () => {
  const workloads = localReport.workloads.map((row) =>
    row.workload === "post" ? { ...row, statements: row.statements + 1 } : row,
  );
  expect(compareCounters({ ...localReport, workloads })).toEqual(["local postMessage (post) statements: 9 -> 10"]);
});

test("an idle timer increase identifies both counts", () => {
  expect(compareCounters({ ...localReport, idleTimers: 1 })).toEqual(["local timers armed when idle: 0 -> 1"]);
});

test("a mode without a recorded budget has no counter failures", () => {
  expect(compareCounters({ mode: "hosted", workloads: [], idleTimers: 1 })).toEqual([]);
});
