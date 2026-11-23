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

const modeBudgets: Partial<Record<Mode, ModeBudget>> = budgets;
const measuredBudgetMultiplier = 1.2;

/** Returns diagnostics for increased exact counters and measured values more than 20% over budget. */
export function compareBudgets(report: ModeReport): string[] {
  const budget = modeBudgets[report.mode];
  if (!budget) return [];

  const failures: string[] = [];
  for (const { workload, operation, statements, p50, p99 } of report.workloads) {
    const name = `${report.mode} ${operation} (${workload})`;
    const previous = budget.counters.statements[workload];
    if (statements > previous) {
      failures.push(`${name} statements: ${previous} -> ${statements}`);
    }

    const { p50Ms, p99Ms } = budget.measured[workload];
    for (const [metric, value, limit] of [
      ["p50", p50, p50Ms],
      ["p99", p99, p99Ms],
    ] as const) {
      if (value > limit * measuredBudgetMultiplier) {
        failures.push(`${name} ${metric}: ${value} ms exceeds budget ${limit} ms by more than 20%`);
      }
    }
  }
  if (report.idleTimers > budget.counters.idleTimers) {
    failures.push(`${report.mode} timers armed when idle: ${budget.counters.idleTimers} -> ${report.idleTimers}`);
  }
  return failures;
}
