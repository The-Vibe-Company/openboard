---
id: 32
title: Refuse a registered statement that filters on no tenant
milestone: M0-foundations
package: driver-sql
writes:
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/test/statements.test.ts
conformance: []
modes: []
depends_on: [01]
status: ready
claimed_by: null
issue: 32
---

## What the user does
As a contributor, I cannot register a statement that could read or write across organizations.

## Done when
- [ ] registering `SELECT id FROM messages WHERE id = ?` in `packages/driver-sql/src/statements.ts` makes `bun run verify` fail naming the statement
- [ ] a statement whose predicate includes `board_id` or `org_id`, or one listed as a platform statement, passes

## Out of scope
- `EXPLAIN` of every statement on both engines and schema parity (M5, 165, 166).
- The isolation suites (33, 135).

## Notes
`docs/codebase.md` 3.2 (statement row) and 4.4; `docs/data-model.md` "Tenancy". Owner-reviewed: label `isolation`.
