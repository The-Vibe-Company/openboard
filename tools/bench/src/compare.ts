import budgets from "../budgets.json";
import type { ModeReport } from "./counters";
import type { Mode } from "./drivers";
import type { WorkloadName } from "./workloads/messages";

interface CounterBudget {
  readonly statements: Readonly<Record<WorkloadName, number>>;
  readonly idleTimers: number;
}

interface LatencyBudget {
  readonly p50Ms: number;
  readonly p99Ms: number;
}

interface ModeBudget {
  readonly counters: CounterBudget;
  readonly measured: Readonly<Record<WorkloadName, LatencyBudget>>;
}

const modeBudgets: Record<Mode, ModeBudget> = budgets;
const measuredBudgetMultiplier = 1.2;
/** Sub-millisecond timings jitter on shared CI runners: tenths of a millisecond at p50, up to a millisecond at p99. */
const measuredNoiseFloorMs = { p50: 0.5, p99: 1 } as const;

/**
 * Returns diagnostics for increased exact counters and, when `latency` holds, measured values more than 20% and the
 * noise floor over budget.
 */
export function compareBudgets(report: ModeReport, { latency }: { readonly latency: boolean }): string[] {
  const budget = modeBudgets[report.mode];

  const failures: string[] = [];
  for (const { workload, operation, statements, p50, p99 } of report.workloads) {
    const name = `${report.mode} ${operation} (${workload})`;
    const previous = budget.counters.statements[workload];
    if (statements > previous) {
      failures.push(`${name} statements: ${previous} -> ${statements}`);
    }

    if (!latency) continue;
    compareLatency(name, { p50, p99 }, budget.measured[workload], failures);
  }
  if (latency && report.mode === "local" && report.sse) {
    compareLatency("local SSE fan-out", report.sse, budgets.local.sseFanOut, failures);
  }
  if (report.idleTimers > budget.counters.idleTimers) {
    failures.push(`${report.mode} timers armed when idle: ${budget.counters.idleTimers} -> ${report.idleTimers}`);
  }
  return failures;
}

function compareLatency(
  name: string,
  { p50, p99 }: { readonly p50: number; readonly p99: number },
  { p50Ms, p99Ms }: LatencyBudget,
  failures: string[],
): void {
  for (const [metric, value, limit] of [
    ["p50", p50, p50Ms],
    ["p99", p99, p99Ms],
  ] as const) {
    const floor = measuredNoiseFloorMs[metric];
    if (value > Math.max(limit * measuredBudgetMultiplier, limit + floor)) {
      failures.push(`${name} ${metric}: ${value} ms exceeds budget ${limit} ms by more than 20% and ${floor} ms`);
    }
  }
}
