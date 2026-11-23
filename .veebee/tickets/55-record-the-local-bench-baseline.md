---
id: 55
title: Record the local bench baseline
milestone: M1-walking-skeleton
package: tools
writes:
  - tools/bench/src/**
  - tools/bench/budgets.json
  - packages/driver-sqlite/src/counters.ts
conformance: []
modes: [local]
depends_on: [05, 48]
status: draft
claimed_by: null
issue: 55
---

## What the user does
As a contributor, I see how fast the local board posts and reads, recorded as the numbers to hold.

## Done when
- [ ] `bun run bench --quick --mode local` runs the post, reply and channel-read workloads and prints p50, p99 and statements per operation
- [ ] `tools/bench/budgets.json` holds them under `local`, never looser than the targets in `docs/architecture.md` "Efficiency budgets"

## Out of scope
- Failing on a regression (56, 57).
- The hosted baseline (M5, 173).

## Notes
`docs/codebase.md` 6.6; D41. This ticket closes M1's "local bench baseline in `budgets.json`".
