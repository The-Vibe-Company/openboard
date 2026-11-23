---
id: 64
title: Refuse a stale generated file
milestone: M1-walking-skeleton
package: tools
writes:
  - scripts/ci/gen.ts
  - scripts/ci/gen.test.ts
  - package.json
conformance: []
modes: [local]
depends_on: [63]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a contributor, I cannot merge a contract change without regenerating what derives from it.

## Done when
- [ ] changing an operation's `summary` without running `bun run gen` makes `bun run verify` fail naming `openapi.json`

## Out of scope
- Generating anything new.

## Notes
`docs/codebase.md` 4.2 (`gen:check` in the required check).
