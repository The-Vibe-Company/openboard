---
id: 108
title: Measure 50 SSE tails in the local bench
milestone: M3-live-tail
package: tools
writes:
  - tools/bench/src/workloads/sse.ts
  - tools/bench/budgets.json
  - tools/bench/src/counters.ts
  - tools/bench/src/run.ts
  - tools/bench/src/compare.ts
  - tools/bench/test/compare.test.ts
  - docs/architecture.md
conformance: []
modes: [local]
depends_on: [57, 99]
status: done
claimed_by: codex
issue: 108
---

## What the user does
As a contributor, I know live fan-out stays within budget as the code changes.

## Done when
- [x] `bun run bench --quick --mode local` runs 50 SSE tails receiving 1,000 events and reports fan-out time within the local budget in `tools/bench/budgets.json`

## Out of scope
- The hosted cross-instance measure (M6).

## Notes
`docs/codebase.md` 6.6. The local budget is the measured regression baseline approved for #108. The 5 ms architecture target remains in place for the fan-out optimization follow-up.
