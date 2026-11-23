---
id: 192
title: Run the nightly checks against staging
milestone: M6-high-availability
package: tools
writes:
  - .github/workflows/nightly.yml
  - tools/conformance/src/run.ts
  - tools/conformance/test/url.test.ts
conformance: []
modes: [local, hosted]
depends_on: [190]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the owner, every night I learn whether staging still passes the kit, whether the full bench holds its budgets in both modes, and whether any test is flaky.

## Done when
- [ ] `bun run conformance --url https://<staging host>/api/conformance-ci/main < secret-file` runs the kit against staging as that connection and exits 0 when it passes every check `hosted` lists
- [ ] `gh workflow run nightly.yml` produces a green run with three jobs: conformance against staging, the full bench in both modes, and `bun test --rerun-each 3` on both drivers; a failing job opens a GitHub issue naming it

## Out of scope
- Playwright journeys (M8); posting results to the board's `openboard/ops` channel (dogfooding phase A, M7).
- Holding the full bench for seven nights (M15, 401).

## Notes
- docs/codebase.md 6.3 (`--url`, secret on stdin) and 6.7 (`nightly.yml`). `--url` skips booting and seeding in `tools/conformance/src/drivers.ts` and compares with the mode's list in `score.json` without `--update`; the self-host check of M7 (213) reuses it.
- The hosted full bench runs against the runner's Postgres service: staging's database sits on Railway's private network and docs/codebase.md 6.6's "hosted against staging's Postgres" would need it exposed (a question for the owner in the PR that wrote this ticket).
- The secret comes from the GitHub environment `staging` (191); it is never printed.
