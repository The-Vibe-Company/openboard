---
id: 16
title: Refuse a source file over 400 lines or a test over 600
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/sizes.ts
  - scripts/ci/sizes.test.ts
  - package.json
conformance: []
modes: []
depends_on: [06]
status: done
claimed_by: codex-t16
issue: 16
---

## What the user does
As a contributor, I split a file before it grows past its limit; there is no allowlist.

## Done when
- [x] a 401-line source file makes `bun run lint` exit 1 naming it, while generated files (`*.gen.ts`, `openapi.json`, `commands.md`) pass at any length
- [x] a 601-line `*.test.ts` makes `bun run lint` exit 1 naming it

## Out of scope
- Files per directory (17).
- PR size (19).

## Notes
`docs/codebase.md` 5.1.
