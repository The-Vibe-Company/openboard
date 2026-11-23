---
id: 30
title: Refuse an edit to an applied migration
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/migrations.ts
  - scripts/ci/migrations.test.ts
  - scripts/ci/fixtures/migrations/edited/**
conformance: []
modes: []
depends_on: [29]
status: ready
claimed_by: null
issue: 30
---

## What the user does
As a contributor, I add a new migration instead of editing one `main` already has.

## Done when
- [ ] changing one byte of a migration that exists on `main` makes `bun run lint` exit 1 naming the file

## Out of scope
- Numbering (29).

## Notes
`docs/codebase.md` 3.3 point 4.
