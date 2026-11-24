---
id: 408
title: Run the PR size check in CI
milestone: M15-operations
package: tools
writes:
  - .github/workflows/ci.yml
  - scripts/ci/pr-size.ts
  - scripts/ci/pr-size.test.ts
conformance: []
modes: [local]
depends_on: []
status: draft
claimed_by: null
issue: 727
---

## What the user does
As the owner, a pull request over the size limits fails the required check unless it carries the label that allows it, as ticket 19 designed.

## Done when
- [ ] the `static` job of `.github/workflows/ci.yml` runs `bun scripts/ci/pr-size.ts` on pull requests, reading the base, head and labels from the event, and `bun test scripts/ci/pr-size.test.ts` covers a PR under the limits, one over them, and one over them with the allowing label
- [ ] `actionlint .github/workflows/ci.yml` passes, and the check is skipped (not failed) on pushes to main

## Out of scope
- Changing the limits.

## Notes
Found reviewing #234: ticket 19 built `scripts/ci/pr-size.ts` but nothing runs it. Read labels from `github.event.pull_request.labels` through an env variable, never by interpolating the event into the script. Merges of release-please PRs and generated files (`openapi.json`, the skill's command reference) must not count toward the size, if the script doesn't already exclude them.
