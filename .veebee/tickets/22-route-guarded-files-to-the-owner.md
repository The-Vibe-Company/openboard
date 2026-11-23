---
id: 22
title: Route guarded files to the owner for review
milestone: M0-foundations
package: tools
writes:
  - .github/CODEOWNERS
conformance: []
modes: []
depends_on: [01]
status: done
claimed_by: claude-opus-5-5
issue: 22
---

## What the user does
As the owner, I am asked to review any PR that touches the files that widen the rules or weaken isolation.

## Done when
- [ ] a PR changing any of `scripts/ci/boundaries.json`, `.oxlintrc.json`, `biome.json`, `tools/conformance/score.json`, `tools/bench/budgets.json`, `packages/driver-sql/migrations/`, `packages/ports/testkit/isolation.test-suite.ts`, `packages/server/test/isolation/**` or `.github/` requests review from the owner automatically

## Out of scope
- The PR template (21).

## Notes
Guarded files: `docs/codebase.md` 3.3 (last paragraph).
