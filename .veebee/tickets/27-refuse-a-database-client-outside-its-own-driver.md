---
id: 27
title: Refuse a database client outside its own driver
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/boundaries.ts
  - scripts/ci/boundaries.json
  - scripts/ci/fixtures/boundaries/db-client/**
conformance: []
modes: []
depends_on: [26]
status: ready
claimed_by: null
issue: 27
---

## What the user does
As a contributor, I can only open SQLite inside `driver-sqlite` and Postgres inside `driver-postgres`.

## Done when
- [ ] `import { Database } from "bun:sqlite"` outside `packages/driver-sqlite`, or `import { SQL } from "bun"` outside `packages/driver-postgres` (including in `driver-sql`), makes `bun run lint` exit 1 naming the file and the module

## Out of scope
- SQL text (28).

## Notes
`docs/codebase.md` 3.2 (second row) and 3.3 point 1 ("a forbidden module outside its package").
