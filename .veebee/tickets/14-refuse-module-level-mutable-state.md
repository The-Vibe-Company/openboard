---
id: 14
title: Refuse module-level mutable state
milestone: M0-foundations
package: tools
writes:
  - .oxlintrc.json
  - scripts/ci/fixtures/oxlint/mutable/**
conformance: []
modes: []
depends_on: [13]
status: ready
claimed_by: null
issue: 14
---

## What the user does
As a contributor, I cannot keep state at module level, so two apps in one process share nothing.

## Done when
- [ ] a top-level `let`, a module-scope `new Map()` that is later mutated, or a `static` mutable class field in `packages/*/src` or `apps/openboard/src` makes `bun run lint` exit 1 naming the file and line

## Out of scope
- Function length (15).
- State that must cross instances (ports, from 97 on).

## Notes
`docs/codebase.md` 3.2 (module-level state row) and 5.6. Neither mechanism in 3.3 names this rule: ask before adding a third one.
