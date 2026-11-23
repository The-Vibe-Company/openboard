import { argv } from "node:process";
import { parseArgs } from "node:util";
import { formatTable, measure } from "./counters";
import { modes } from "./drivers";

const { values } = parseArgs({
  args: argv.slice(2),
  options: {
    mode: { type: "string" },
    // Workloads arrive with the local baseline; until then the quick and full runs both print the counters.
    quick: { type: "boolean", default: false },
  },
});
const selected = modes.filter((mode) => values.mode === undefined || values.mode === mode);
if (selected.length === 0) throw new Error("--mode must be local or hosted");

const tables: string[] = [];
for (const mode of selected) tables.push(formatTable(await measure(mode)));
console.log(tables.join("\n\n"));
