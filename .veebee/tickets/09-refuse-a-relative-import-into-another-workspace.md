---
id: 09
title: Refuse a relative import into another workspace
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/boundaries.ts
  - scripts/ci/fixtures/boundaries/relative/**
conformance: []
modes: []
depends_on: [08]
status: ready
claimed_by: null
issue: 9
---

## What the user does
As a contributor, I can only reach another workspace through its package name.

## Done when
- [ ] `import "../../contract/src/errors"` in `packages/core/src` makes `bun run lint` exit 1 naming the path

## Out of scope
- The workspace edge rule (06).

## Notes
`docs/codebase.md` 3.1 universal rules.
