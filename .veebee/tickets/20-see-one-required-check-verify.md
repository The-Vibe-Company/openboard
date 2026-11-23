---
id: 20
title: See one required check, Verify, on every pull request
milestone: M0-foundations
package: tools
writes:
  - .github/workflows/ci.yml
conformance: []
modes: [local]
depends_on: [04, 19]
status: ready
claimed_by: null
issue: 20
---

## What the user does
As a contributor, I open a PR and see one check, Verify, that says whether it can merge.

## Done when
- [ ] a PR to `main` shows one required check named `Verify`, fed by the parallel jobs `static`, `unit-sqlite`, `conformance-sqlite` and `bench`, and it is green
- [ ] on `main`, Verify finishes in under two minutes (the Actions run page shows the duration)

## Out of scope
- The `postgres` and `conformance-postgres` jobs with their service container (35).
- Branch protection and merge-queue settings: the owner's (`docs/project.md` section 3).
- `web.yml`, `nightly.yml`, `release.yml`: later milestones.

## Notes
`docs/codebase.md` 6.7 (jobs, aggregate, no internet, no retries, Bun install cache).
