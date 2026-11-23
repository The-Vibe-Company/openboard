import { boot, type Mode } from "./drivers";
import { countArmedTimers } from "./timers";
import { runMessageWorkloads, type Sizes, type WorkloadResult } from "./workloads/messages";

export interface ModeReport {
  readonly mode: Mode;
  readonly workloads: readonly WorkloadResult[];
  readonly idleTimers: number;
}

/**
 * Boots `mode`, counts the timers it leaves armed once settled, then runs the workloads of `sizes` on it. Hosted mode
 * runs no workload until the Postgres driver records its baseline (M5).
 */
export async function measure(mode: Mode, sizes: Sizes): Promise<ModeReport> {
  let server: ReturnType<typeof boot> | undefined;
  try {
    const idleTimers = await countArmedTimers(async () => {
      server = boot(mode);
      await Promise.all(server.instances.map(({ app }) => app.drain()));
    });
    const workloads = mode === "local" && server ? await runMessageWorkloads(server, sizes) : [];
    return { mode, workloads, idleTimers };
  } finally {
    await server?.close();
  }
}

const COLUMNS = ["Runs", "Statements", "p50 ms", "p99 ms"];
const CELL = 12;

/** Renders one mode's table: one row per workload with its operation, statements per request and latency. */
export function formatTable(report: ModeReport): string {
  const width = Math.max(
    16,
    ...report.workloads.map(({ workload }) => workload.length + 2),
    ...report.workloads.map(({ operation }) => operation.length + 2),
  );
  const header = "Workload".padEnd(width) + "Operation".padEnd(width) + COLUMNS.map((c) => c.padStart(CELL)).join("");
  const rows = report.workloads.map((row) => {
    const cells = [String(row.runs), String(row.statements), row.p50.toFixed(3), row.p99.toFixed(3)];
    return row.workload.padEnd(width) + row.operation.padEnd(width) + cells.map((c) => c.padStart(CELL)).join("");
  });
  if (rows.length === 0) rows.push("(no workloads yet: the hosted baseline arrives with the Postgres driver)");
  const idle = "Timers armed when idle".padEnd(2 * width) + String(report.idleTimers).padStart(CELL);
  return [report.mode, header, ...rows, idle].join("\n");
}
