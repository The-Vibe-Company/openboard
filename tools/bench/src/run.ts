import { writeFileSync, writeSync } from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";
import { compareBudgets } from "./compare";
import { formatTable, measure } from "./counters";
import { modes } from "./drivers";
import { fullSizes, quickSizes } from "./workloads/messages";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    mode: { type: "string" },
    json: { type: "string" },
    // The quick run is the required check's: the same workloads, fewer requests.
    quick: { type: "boolean", default: false },
  },
});
const selected = modes.filter((mode) => values.mode === undefined || values.mode === mode);
if (selected.length === 0) throw new Error("--mode must be local or hosted");

if (values.json !== undefined && selected.length !== 1) throw new Error("--json needs --mode local or hosted");

const sizes = values.quick ? quickSizes : fullSizes;
// At 100 samples, nearest-rank p99 is the 99th observation instead of the maximum.
const taskCycles = values.quick ? 100 : 500;
const tables: string[] = [];
const failures: string[] = [];
for (const mode of selected) {
  const report = await measure(mode, sizes, { includeSse: true, taskCycles });
  tables.push(formatTable(report));
  // The required check holds both modes' counters and local latencies only (docs/codebase.md 6.7): hosted latencies
  // are held by the full bench, since a quick run's round trips to a shared runner's Postgres jitter too much. The
  // SSE fan-out's p99 (50 tails, a 3 ms budget) moves with the shared runner too, so the nightly full bench holds it.
  const modeFailures = compareBudgets(report, {
    latency: !values.quick || mode === "local",
    sseLatency: !values.quick,
  });
  failures.push(...modeFailures);
  if (values.json !== undefined) {
    writeFileSync(values.json, `${JSON.stringify({ report, quick: values.quick, failures: modeFailures })}\n`);
  }
}
writeSync(process.stdout.fd, `${tables.join("\n\n")}\n`);
if (failures.length > 0) {
  writeSync(process.stderr.fd, `${failures.join("\n")}\n`);
  // An idle timer regression can keep the process alive after the benchmarks close.
  process.exit(1);
}
