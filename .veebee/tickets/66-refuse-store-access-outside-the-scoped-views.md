---
id: 66
title: Refuse store access outside the scoped views
milestone: M1-walking-skeleton
package: tools
writes:
  - scripts/ci/boundaries.ts
  - scripts/ci/boundaries.json
  - scripts/ci/fixtures/boundaries/store/**
conformance: []
modes: [local]
depends_on: [28, 36]
status: draft
claimed_by: null
issue: 66
---

## What the user does
As a contributor, I cannot reach the unscoped store from a handler.

## Done when
- [ ] importing the `Store` type in `packages/server/src/operations/messages.ts` makes `bun run lint` exit 1 naming the file; the same import in `packages/server/src/http/scope.ts` or `packages/server/src/app.ts` passes

## Out of scope
- The typed views themselves (36).

## Notes
`docs/codebase.md` 3.2 ("Store access in server" row). 3.3 point 3 says TypeScript makes the rule structural but names no check for the file rule; this ticket adds it to `boundaries.ts`: owner to confirm. Placed in M1 because it needs the server's store wiring.
