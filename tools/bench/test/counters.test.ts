import { expect, test } from "bun:test";
import { formatTable, measure } from "../src/counters";
import { percentile } from "../src/workloads/request";
import { countArmedTimers } from "../src/timers";

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

test("hosted runs no workload until its baseline, and still counts idle timers", async () => {
  expect(formatTable(await measure("hosted", sizes))).toBe(
    [
      "hosted",
      `${"Workload".padEnd(16)}${"Operation".padEnd(16)}        Runs  Statements      p50 ms      p99 ms`,
      "(no workloads yet: the hosted baseline arrives with the Postgres driver)",
      `${"Timers armed when idle".padEnd(32)}${"0".padStart(12)}`,
    ].join("\n"),
  );
});

test("percentiles take the nearest rank", () => {
  const values = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
  expect([percentile(values, 50), percentile(values, 99), percentile([7], 50)]).toEqual([5, 10, 7]);
  expect(() => percentile([], 50)).toThrow(RangeError);
});
