---
id: 274
title: Measure 500 task cycles in the bench
milestone: M9-tasks
package: tools
writes:
  - tools/bench/src/workloads/tasks.ts
  - tools/bench/src/run.ts
  - tools/bench/budgets.json
  - tools/bench/test/tasks.test.ts
conformance: []
modes: [local, hosted]
depends_on: [243, 108]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the owner, the bench measures creating, claiming and completing tasks in both modes, so a slower claim fails CI.

## Done when
- [ ] `bun run bench --quick` runs the task workload in local mode and prints the statements per `taskCreate`, `taskClaim` and `taskComplete` and their p50 and p99; `bun run bench` runs 500 cycles; `tools/bench/budgets.json` holds the measured counters as these operations' budgets
- [ ] `bun run bench --mode hosted --quick` with the test Postgres up prints the same operations' round trips, and `bun test tools/bench/test/tasks.test.ts` passes

## Out of scope
- The full nightly bench (401).

## Notes
docs/codebase.md 6.6 ("500 task create/claim/complete cycles"), docs/architecture.md "Efficiency budgets". A new budget is the first measurement, never looser than a target; raising one is the owner's call (label `perf`). Depends on 108, the last ticket before it to change `budgets.json`.
