---
id: 57
title: Fail the bench when a measured value passes its budget
milestone: M1-walking-skeleton
package: tools
writes:
  - tools/bench/src/compare.ts
  - tools/bench/test/compare.test.ts
  - tools/bench/src/run.ts
  - docs/codebase.md
  - .veebee/tickets/57-fail-the-bench-when-a-measured-value-passes-its-budget.md
conformance: []
modes: [local]
depends_on: [56]
status: done
claimed_by: codex
issue: 57
---

## What the user does
As a contributor, I learn that my change made the board slower or bigger than its budget.

## Done when
- [x] a write made more than 20% over its budget makes `bun run bench --quick` exit 1 naming the metric, the value and the budget

## Out of scope
- Raising a budget: owner only.

## Notes
Threshold follows `docs/architecture.md` and D41. Exact counters still fail on any increase.
