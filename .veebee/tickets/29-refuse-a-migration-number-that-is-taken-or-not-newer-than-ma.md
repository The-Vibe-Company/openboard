---
id: 29
title: Refuse a migration number that is taken or not newer than main's
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/migrations.ts
  - scripts/ci/migrations.test.ts
  - scripts/ci/fixtures/migrations/numbers/**
  - package.json
conformance: []
modes: []
depends_on: [19]
status: done
claimed_by: codex
issue: 29
---

## What the user does
As a contributor, I find out before merging that my migration's number collides or is older than what `main` has.

## Done when
- [ ] two files numbered `0002-…sql` in `packages/driver-sql/migrations/`, or a new file numbered below `main`'s newest, make `bun run lint` exit 1 naming them

## Out of scope
- Edits to applied files (30), destructive statements (31), rendering to SQLite (65).

## Notes
`docs/codebase.md` 3.3 point 4 and `docs/project.md` section 5 (numbers taken at merge time; the merge queue re-runs Verify).
