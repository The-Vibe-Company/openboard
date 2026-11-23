---
id: 07
title: Refuse a package manifest that disagrees with its imports
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/boundaries.ts
  - scripts/ci/fixtures/boundaries/manifest/**
conformance: []
modes: []
depends_on: [06]
status: ready
claimed_by: null
issue: 7
---

## What the user does
As a contributor, I cannot declare a dependency a package does not use, or use one it does not declare.

## Done when
- [ ] a workspace importing a package missing from its `package.json` makes `bun run lint` exit 1 naming the package
- [ ] a workspace declaring a dependency outside its allow-list makes `bun run lint` exit 1 naming it

## Out of scope
- The import-edge rule (06).
- Approving a new dependency: owner review of `boundaries.json` (22).

## Notes
`docs/codebase.md` 3.3 point 1.
