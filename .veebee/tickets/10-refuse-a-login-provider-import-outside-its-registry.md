---
id: 10
title: Refuse an import of a login provider from outside its registry
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/boundaries.ts
  - scripts/ci/boundaries/**
  - scripts/ci/fixtures/boundaries/provider/**
conformance: []
modes: []
depends_on: [09]
status: claimed
claimed_by: claude-code-t10
issue: 10
---

## What the user does
As a contributor, I can only reach a login provider's code through the provider registry.

## Done when
- [ ] a server file other than `packages/server/src/auth/providers/index.ts` importing from `auth/providers/github/` makes `bun run lint` exit 1 naming both files

## Out of scope
- The GitHub provider itself (133).
- Deny terms (08).

## Notes
`docs/codebase.md` 3.2 (provider directory row and the GitHub paragraph).
