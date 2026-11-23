---
id: 26
title: Refuse driver-sql outside the two drivers
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/boundaries.ts
  - scripts/ci/fixtures/boundaries/driver-sql/**
conformance: []
modes: []
depends_on: [25]
status: ready
claimed_by: null
issue: 26
---

## What the user does
As a contributor, I can only use the shared SQL module from inside a driver.

## Done when
- [ ] importing `@openboard/driver-sql` in `packages/server` or `apps/openboard` makes `bun run lint` exit 1 naming the file; the same import in `packages/driver-postgres` passes

## Out of scope
- SQL text outside drivers (28).

## Notes
`docs/codebase.md` 3.1 ("`driver-sql` is imported only by `driver-sqlite` and `driver-postgres`").
