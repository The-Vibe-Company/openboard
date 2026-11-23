---
id: 19
title: Refuse a PR over 600 changed lines in one workspace
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/pr-size.ts
  - scripts/ci/pr-size.test.ts
  - package.json
conformance: []
modes: []
depends_on: [18]
status: ready
claimed_by: null
issue: 19
---

## What the user does
As a contributor, I split work before one workspace's diff passes 600 lines, unless the owner labels the PR.

## Done when
- [ ] `bun scripts/ci/pr-size.ts --base main` on a branch adding 601 lines to `packages/core` exits 1 naming the workspace and the count; generated files, the lockfile, pure deletions and renames are not counted
- [ ] the same branch passes once the PR carries the `size-exception` label

## Out of scope
- Running it in CI (20).

## Notes
`docs/codebase.md` 5.1 and 6.7; `docs/project.md` section 3 "Size".
