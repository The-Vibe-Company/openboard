---
id: 17
title: Refuse a directory of more than 15 source files
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/sizes.ts
  - scripts/ci/sizes.test.ts
conformance: []
modes: []
depends_on: [16]
status: done
claimed_by: claude-opus-t17
issue: 17
---

## What the user does
As a contributor, I split a directory into subdirectories once it holds 15 source files.

## Done when
- [x] a 16th source file in one directory under `packages/*/src` makes `bun run lint` exit 1 naming the directory

## Out of scope
- File length (16).

## Notes
`docs/codebase.md` 5.1.
