import { boot, type Mode, type Server } from "./drivers";
import { countArmedTimers } from "./timers";
import { runMessageWorkloads, type Sizes, type WorkloadResult } from "./workloads/messages";
import { runSseWorkload, type SseResult } from "./workloads/sse";

export interface ModeReport {
  readonly mode: Mode;
  readonly workloads: readonly WorkloadResult[];
  readonly idleTimers: number;
  readonly sse?: SseResult;
}

/** Boots `mode`, counts the timers it leaves armed once settled, then runs the workloads of `sizes` on it. */
export async function measure(
  mode: Mode,
  sizes: Sizes,
  { includeSse = false }: { readonly includeSse?: boolean } = {},
): Promise<ModeReport> {
  let server: Server | undefined;
  try {
    const idleTimers = await countArmedTimers(async () => {
      server = await boot(mode);
      await Promise.all(server.instances.map(({ app }) => app.drain()));
    });
    if (!server) throw new Error(`${mode} did not boot`);
    const workloads = await runMessageWorkloads(server, sizes);
    const sse = includeSse && mode === "local" ? await runSseWorkload(server) : undefined;
    return { mode, workloads, idleTimers, sse };
  } finally {
    await server?.close();
  }
}

const CELL = 12;

/** Renders one mode's table: one row per workload with its operation, database counters per request and latency. */
export function formatTable(report: ModeReport): string {
  const width = Math.max(
    16,
    ...report.workloads.map(({ workload }) => workload.length + 2),
    ...report.workloads.map(({ operation }) => operation.length + 2),
  );
  const columns = ["Runs", "Statements"];
  if (report.mode === "hosted") columns.push("Round trips");
  columns.push("p50 ms", "p99 ms");
  const header = "Workload".padEnd(width) + "Operation".padEnd(width) + columns.map((c) => c.padStart(CELL)).join("");
  const rows = report.workloads.map((row) => {
    const cells = [String(row.runs), String(row.statements)];
    if (report.mode === "hosted") cells.push(String(row.roundTrips));
    cells.push(row.p50.toFixed(3), row.p99.toFixed(3));
    return row.workload.padEnd(width) + row.operation.padEnd(width) + cells.map((c) => c.padStart(CELL)).join("");
  });
  const idle = "Timers armed when idle".padEnd(2 * width) + String(report.idleTimers).padStart(CELL);
  const lines = [report.mode, header, ...rows, idle];
  if (report.sse) {
    const { tails, events, p50, p99 } = report.sse;
    lines.push(
      `SSE fan-out: ${tails} tails received ${events} events each (p50 ${p50.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms)`,
    );
  }
  return lines.join("\n");
}
