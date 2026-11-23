---
id: 55
title: Record the local bench baseline
milestone: M1-walking-skeleton
package: tools
writes:
  - tools/bench/src/**
  - tools/bench/budgets.json
  - packages/driver-sqlite/src/counters.ts
  - packages/driver-sqlite/src/open.ts
  - packages/driver-sqlite/src/index.ts
  - packages/driver-sqlite/test/counters.test.ts
  - tools/bench/test/counters.test.ts
  - tools/bench/package.json
  - tools/bench/tsconfig.json
  - bun.lock
conformance: []
modes: [local]
depends_on: [05, 48]
status: claimed
claimed_by: claude-opus-t55
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
