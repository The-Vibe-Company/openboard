---
id: 15
title: Refuse a function over 80 lines
milestone: M0-foundations
package: tools
writes:
  - .oxlintrc.json
  - scripts/ci/fixtures/oxlint/fnlen/**
conformance: []
modes: []
depends_on: [14]
status: ready
claimed_by: null
issue: 15
---

## What the user does
As a contributor, I split a function before it passes 80 lines.

## Done when
- [ ] an 81-line function in any workspace makes `bun run lint` exit 1 naming it

## Out of scope
- File and directory sizes (16, 17).

## Notes
`docs/codebase.md` 5.1.
