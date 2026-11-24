import { expect, test } from "bun:test";
import process from "node:process";
import { compareBudgets } from "../src/compare";
import { type ModeReport, measure } from "../src/counters";

const sizes = { posts: 1, replies: 1, reads: 1 };
const taskCycles = 2;

function taskRows(report: ModeReport) {
  return report.workloads.filter(({ workload }) => workload.startsWith("task"));
}

test("the local bench measures each step of two task cycles and fails on a higher claim counter", async () => {
  const report = await measure("local", sizes, { taskCycles });
  const workloads = taskRows(report);
  expect(workloads.map(({ workload, runs, statements }) => [workload, runs, statements])).toEqual([
    ["taskCreate", 2, 12],
    ["taskClaim", 2, 10],
    ["taskComplete", 2, 11],
  ]);
  for (const { p50, p99 } of workloads) expect(0 < p50 && p50 <= p99).toBe(true);
  expect(compareBudgets({ ...report, workloads }, { latency: false })).toEqual([]);
  const slower = workloads.map((row) =>
    row.workload === "taskClaim" ? { ...row, statements: row.statements + 1 } : row,
  );
  expect(compareBudgets({ ...report, workloads: slower }, { latency: false })).toEqual([
    "local claimTask (taskClaim) statements: 10 -> 11",
  ]);
});

test.skipIf(process.env.OPENBOARD_TEST_DRIVER !== "postgres")(
  "the hosted bench measures statements and round trips for each task step",
  async () => {
    const report = await measure("hosted", sizes, { taskCycles });
    const workloads = taskRows(report);
    expect(
      workloads.map(({ workload, runs, statements, roundTrips }) => [workload, runs, statements, roundTrips]),
    ).toEqual([
      ["taskCreate", 2, 14, 14],
      ["taskClaim", 2, 13, 13],
      ["taskComplete", 2, 14, 14],
    ]);
    expect(compareBudgets({ ...report, workloads }, { latency: false })).toEqual([]);
  },
);
