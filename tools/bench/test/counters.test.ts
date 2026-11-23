import { expect, test } from "bun:test";
import { formatTable, measure } from "../src/counters";
import { countArmedTimers } from "../src/timers";

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

test("each mode prints its counters, with round trips only for hosted", async () => {
  expect(formatTable(await measure("local"))).toBe(
    [
      "local",
      "Operation                 Statements",
      "(no operations yet)",
      "Timers armed when idle             0",
    ].join("\n"),
  );
  expect(formatTable(await measure("hosted"))).toBe(
    [
      "hosted",
      "Operation                 Statements Round trips",
      "(no operations yet)",
      "Timers armed when idle             0",
    ].join("\n"),
  );
});

test("an operation not measured yet shows a dash, not a number", () => {
  const table = formatTable({
    mode: "hosted",
    operations: [{ operation: "postMessage", statements: undefined, roundTrips: 3 }],
    idleTimers: 0,
  });
  expect(table.split("\n")[2]).toBe(`${"postMessage".padEnd(24)}${"-".padStart(12)}${"3".padStart(12)}`);
});
