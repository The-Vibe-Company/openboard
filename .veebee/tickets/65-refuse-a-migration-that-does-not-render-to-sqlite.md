---
id: 65
title: Refuse a migration that does not render to SQLite
milestone: M1-walking-skeleton
package: tools
writes:
  - scripts/ci/migrations.ts
  - scripts/ci/fixtures/migrations/render/**
conformance: []
modes: [local]
depends_on: [31, 39]
status: draft
claimed_by: null
issue: 65
---

## What the user does
As a contributor, I find out before merging that my Postgres-syntax migration has no SQLite rendering.

## Done when
- [ ] a migration using a type with no row in the mapping of `docs/data-model.md` "DDL" (for example `TIMESTAMPTZ`) makes `bun run lint` exit 1 naming the file and the type

## Out of scope
- Schema parity between engines (M5, 166).

## Notes
`docs/codebase.md` 3.3 point 4; rendering through `packages/driver-sqlite/src/ddl.ts`, which exists from 36. Moved here from M0 because it needs that file.
