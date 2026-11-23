import { writeSync } from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";
import { compareCounters } from "./compare";
import { formatTable, measure } from "./counters";
import { modes } from "./drivers";
import { fullSizes, quickSizes } from "./workloads/messages";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    mode: { type: "string" },
    // The quick run is the required check's: the same workloads, fewer requests.
    quick: { type: "boolean", default: false },
  },
});
const selected = modes.filter((mode) => values.mode === undefined || values.mode === mode);
if (selected.length === 0) throw new Error("--mode must be local or hosted");

const sizes = values.quick ? quickSizes : fullSizes;
const tables: string[] = [];
const failures: string[] = [];
for (const mode of selected) {
  const report = await measure(mode, sizes);
  tables.push(formatTable(report));
  failures.push(...compareCounters(report));
}
writeSync(process.stdout.fd, `${tables.join("\n\n")}\n`);
if (failures.length > 0) {
  writeSync(process.stderr.fd, `${failures.join("\n")}\n`);
  // An idle timer regression can keep the process alive after the benchmarks close.
  process.exit(1);
}
