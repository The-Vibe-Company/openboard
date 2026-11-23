---
id: 108
title: Measure 50 SSE tails in the local bench
milestone: M3-live-tail
package: tools
writes:
  - tools/bench/src/workloads/sse.ts
  - tools/bench/budgets.json
conformance: []
modes: [local]
depends_on: [57, 99]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a contributor, I know live fan-out stays within budget as the code changes.

## Done when
- [ ] `bun run bench --quick --mode local` runs 50 SSE tails receiving 1,000 events and reports fan-out time within the local budget in `tools/bench/budgets.json`

## Out of scope
- The hosted cross-instance measure (M6).

## Notes
`docs/codebase.md` 6.6. This ticket closes M3's "50 SSE tails within the local budget".
