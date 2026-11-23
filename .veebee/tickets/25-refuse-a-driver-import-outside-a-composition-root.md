---
id: 25
title: Refuse a driver import outside a composition root
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/boundaries.ts
  - scripts/ci/boundaries.json
  - scripts/ci/fixtures/boundaries/driver/**
  - scripts/ci/boundaries/driver.ts
  - scripts/ci/boundaries/graph.ts
  - scripts/ci/boundaries/types.ts
conformance: []
modes: []
depends_on: [10]
status: claimed
claimed_by: claude-opus-ticket-25
issue: 25
---

## What the user does
As a contributor, I cannot make a handler depend on one mode by importing a driver.

## Done when
- [ ] importing `@openboard/driver-sqlite` in `packages/server/src/app.ts` makes `bun run lint` exit 1 naming the file and the driver
- [ ] the same import in `apps/openboard/src/compose.ts`, `packages/server/test/support/drivers.ts`, `tools/conformance/src/drivers.ts` or `tools/bench/src/drivers.ts` passes

## Out of scope
- `driver-sql` imports (26).
- Database clients (27).

## Notes
`docs/codebase.md` 3.1 universal rules (composition roots) and 3.3 point 1.
