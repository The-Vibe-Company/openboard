import { argv } from "node:process";
import { parseArgs } from "node:util";
import { formatTable, measure } from "./counters";
import { modes } from "./drivers";
import { fullSizes, quickSizes } from "./workloads/messages";

const { values } = parseArgs({
  args: argv.slice(2),
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
for (const mode of selected) tables.push(formatTable(await measure(mode, sizes)));
console.log(tables.join("\n\n"));
