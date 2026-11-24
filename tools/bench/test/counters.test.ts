import { expect, test } from "bun:test";
import process from "node:process";
import { formatTable, measure } from "../src/counters";
import { boot } from "../src/drivers";
import { countArmedTimers } from "../src/timers";
import { runMessageWorkloads } from "../src/workloads/messages";
import { percentile } from "../src/workloads/request";

const sizes = { posts: 3, replies: 2, reads: 2 };

test("a timer left armed after the work is counted, and a fired or cleared one is not", async () => {
  let interval: ReturnType<typeof setInterval> | undefined;
  const armed = await countArmedTimers(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    clearTimeout(setTimeout(() => {}, 60_000));
    interval = setInterval(() => {}, 60_000);
  });
  clearInterval(interval);
  expect(armed).toBe(1);
});

test("the timer functions are restored after counting, even when the work throws", async () => {
  const { setTimeout, setInterval, clearTimeout, clearInterval } = globalThis;
  const originals = [setTimeout, setInterval, clearTimeout, clearInterval];
  const current = () => [
    globalThis.setTimeout,
    globalThis.setInterval,
    globalThis.clearTimeout,
    globalThis.clearInterval,
  ];
  await countArmedTimers(async () => {});
  expect(current()).toEqual(originals);
  await expect(
    countArmedTimers(async () => {
      throw new Error("boot failed");
    }),
  ).rejects.toThrow("boot failed");
  expect(current()).toEqual(originals);
});

test("local runs the post, reply and channel-read workloads, each with its statements and latency", async () => {
  const report = await measure("local", sizes);
  expect(
    report.workloads.map(({ workload, operation, runs, statements }) => [workload, operation, runs, statements]),
  ).toEqual([
    ["post", "postMessage", 3, 9],
    ["reply", "postMessage", 2, 11],
    ["channelRead", "listMessages", 2, 3],
  ]);
  for (const { p50, p99 } of report.workloads) expect(0 < p50 && p50 <= p99).toBe(true);
  const lines = formatTable(report).split("\n");
  expect(lines[0]).toBe("local");
  expect(lines[1]).toBe(
    `${"Workload".padEnd(16)}${"Operation".padEnd(16)}${"        Runs  Statements      p50 ms      p99 ms"}`,
  );
  expect(lines[2]).toMatch(/^post {12}postMessage {16}3 {11}9 +\d+\.\d{3} +\d+\.\d{3}$/);
  expect(lines[5]).toBe(`${"Timers armed when idle".padEnd(32)}${"0".padStart(12)}`);
});

const postgres = process.env.OPENBOARD_TEST_DRIVER === "postgres";

test.skipIf(!postgres)("hosted runs the workloads on two instances sharing one Postgres database", async () => {
  const server = await boot("hosted");
  try {
    expect(server.instances).toHaveLength(2);
    const workloads = await runMessageWorkloads(server, sizes);
    expect(workloads.map(({ workload, statements, roundTrips }) => [workload, statements, roundTrips])).toEqual([
      ["post", 11, 11],
      ["reply", 14, 14],
      ["channelRead", 4, 4],
    ]);
    // Every request went through the instances in turn, and each one's store sent its own statements.
    for (const { counters } of server.instances) expect(counters.roundTrips).toBeGreaterThan(0);
  } finally {
    await server.close();
  }
});

test("percentiles take the nearest rank", () => {
  const values = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
  expect([percentile(values, 50), percentile(values, 99), percentile([7], 50)]).toEqual([5, 10, 7]);
  expect(() => percentile([], 50)).toThrow(RangeError);
});
