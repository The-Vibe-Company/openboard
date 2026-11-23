---
id: 56
title: Fail the bench when a counter rises
milestone: M1-walking-skeleton
package: tools
writes:
  - tools/bench/src/compare.ts
  - tools/bench/test/compare.test.ts
conformance: []
modes: [local]
depends_on: [55]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a contributor, I learn at once that my change added a statement to a hot operation.

## Done when
- [ ] a change adding one statement per post makes `bun run bench --quick` exit 1 naming `postMessage` with the old and new counts

## Out of scope
- Measured values (57).

## Notes
`docs/codebase.md` 6.6 (counters are exact).
