---
id: 28
title: Refuse SQL outside the driver workspaces
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/boundaries.ts
  - scripts/ci/boundaries.json
  - scripts/ci/boundaries/sql.ts
  - scripts/ci/boundaries/workspaces.ts
  - scripts/ci/fixtures/boundaries/sql/**
conformance: []
modes: []
depends_on: [27]
status: done
claimed_by: codex-ticket-28
issue: 28
---

## What the user does
As a contributor, I keep every SQL statement inside `packages/driver-*`.

## Done when
- [ ] a `.sql` file under `packages/server`, or the template literal `` `SELECT id FROM messages` `` in `packages/core/src`, makes `bun run lint` exit 1 naming the file and the statement head
- [ ] the same literal in `packages/driver-sql/src` passes

## Out of scope
- The tenant filter on registered statements (32).
- Migration rules (29).

## Notes
Statement heads and scope: `docs/codebase.md` 3.2 first row; tokens from the TypeScript scanner (3.3 point 1).
