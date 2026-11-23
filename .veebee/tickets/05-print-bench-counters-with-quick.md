---
id: 05
title: Print bench counters with bun run bench --quick
milestone: M0-foundations
package: tools
writes:
  - tools/bench/**
  - package.json
conformance: []
modes: [local, hosted]
depends_on: [02]
status: ready
claimed_by: null
issue: 5
---

## What the user does
As a contributor, I run the quick benchmark and see the counters it will hold every change to, per mode.

## Done when
- [ ] `bun run bench --quick` prints a `local` and a `hosted` counters table (statements per operation, round trips per operation for hosted, timers armed when idle), with no operations yet, and exits 0 in under 60 seconds
- [ ] `bun run bench --quick --mode local` prints only the `local` table

## Out of scope
- Workloads and the local baseline in `budgets.json` (55); the hosted baseline (M5, 173).
- Failing on a counter rise or a value over budget (56, 57).
- The drivers' statement counters (`driver-*/src/counters.ts`): with the first driver code (55).

## Notes
`docs/codebase.md` 6.6 (one `budgets.json` section per mode). Target numbers live only in `docs/architecture.md` "Efficiency budgets".
