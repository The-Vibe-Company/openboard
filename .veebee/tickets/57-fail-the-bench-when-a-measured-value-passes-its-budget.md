---
id: 57
title: Fail the bench when a measured value passes its budget
milestone: M1-walking-skeleton
package: tools
writes:
  - tools/bench/src/compare.ts
  - tools/bench/test/compare.test.ts
conformance: []
modes: [local]
depends_on: [56]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a contributor, I learn that my change made the board slower or bigger than its budget.

## Done when
- [ ] a write made slower than its budget makes `bun run bench --quick` exit 1 naming the metric, the value and the budget

## Out of scope
- Raising a budget: owner only.

## Notes
Threshold: `docs/codebase.md` 6.6 says over budget fails; `docs/architecture.md` says more than 20% over. See `.veebee/cut.md` "Could not place".
