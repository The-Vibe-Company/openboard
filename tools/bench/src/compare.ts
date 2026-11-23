import budgets from "../budgets.json";
import type { ModeReport } from "./counters";
import type { Mode } from "./drivers";
import type { WorkloadName } from "./workloads/messages";

interface CounterBudget {
  readonly statements: Readonly<Record<WorkloadName, number>>;
  readonly idleTimers: number;
}

const counterBudgets: Partial<Record<Mode, { readonly counters: CounterBudget }>> = budgets;

/** Returns diagnostics for exact counters that rose above the mode's recorded budget. */
export function compareCounters(report: ModeReport): string[] {
  const budget = counterBudgets[report.mode]?.counters;
  if (!budget) return [];

  const failures: string[] = [];
  for (const { workload, operation, statements } of report.workloads) {
    const previous = budget.statements[workload];
    if (statements > previous) {
      failures.push(`${report.mode} ${operation} (${workload}) statements: ${previous} -> ${statements}`);
    }
  }
  if (report.idleTimers > budget.idleTimers) {
    failures.push(`${report.mode} timers armed when idle: ${budget.idleTimers} -> ${report.idleTimers}`);
  }
  return failures;
}
