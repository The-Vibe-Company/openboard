---
id: 54
title: Record a newly passing conformance check
milestone: M1-walking-skeleton
package: tools
writes:
  - tools/conformance/src/run.ts
  - tools/conformance/src/score.ts
  - tools/conformance/test/score.test.ts
conformance: []
modes: [local]
depends_on: [04, 37, 40]
status: draft
claimed_by: null
issue: 54
---

## What the user does
As a contributor, I record the checks my change made pass, so nobody can lose them later.

## Done when
- [ ] `bun run conformance --update` adds `core/says in its discovery where it is` under `local` in `tools/conformance/score.json` and prints it as new
- [ ] a second run prints nothing new and leaves the file unchanged

## Out of scope
- Removing an entry: owner only.
- The hosted list (M5, 170).

## Notes
`docs/codebase.md` 6.3 step 4.
