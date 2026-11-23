---
id: 31
title: Refuse a destructive migration without the contract-phase marker
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/migrations.ts
  - scripts/ci/migrations.test.ts
  - scripts/ci/fixtures/migrations/destructive/**
conformance: []
modes: []
depends_on: [30]
status: ready
claimed_by: null
issue: 31
---

## What the user does
As a contributor, I cannot drop, rename or tighten a column during a deploy that still has old instances running.

## Done when
- [ ] a migration with `DROP`, `RENAME`, `ALTER … TYPE` or `SET NOT NULL` without a default makes `bun run lint` exit 1 naming the statement
- [ ] the same statement in a file marked `-- contract-phase` passes

## Out of scope
- Checking that an earlier release stopped using the object: a review step (`docs/codebase.md` 7.5).

## Notes
`docs/codebase.md` 3.3 point 4 and 7.5 (expand/contract).
