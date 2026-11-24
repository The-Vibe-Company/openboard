---
id: 401
title: Hold the full bench within budgets for seven nightly runs
milestone: M15-operations
package: tools
writes:
  - tools/bench/src/run.ts
  - tools/bench/src/streak.ts
  - tools/bench/test/streak.test.ts
  - .github/workflows/nightly.yml
conformance: []
modes: [local, hosted]
depends_on: [192, 237, 274]
status: done
claimed_by: codex
issue: 596
---

## What the user does
As the owner, I see in one command whether the full bench has stayed within its budgets in both modes for the last seven nightly runs, and which budget broke the streak if not.

## Done when
- [ ] `nightly.yml` runs the full bench in both modes (`bun run bench --mode local` on the compiled binary, `bun run bench --mode hosted` against the runner's Postgres service) and uploads each run's JSON result as an artifact named by mode
- [ ] `bun tools/bench/src/streak.ts --runs 7` reads the last seven nightly runs on `main` (through `gh`), exits 0 when every one passed every budget in both modes, and otherwise exits 1 naming each failed run, mode, budget and value; `bun test tools/bench/test/streak.test.ts` covers both with fixture results
- [ ] `bun tools/bench/src/streak.ts --runs 7` exits 0 on the real nightly runs, and the PR that closes M15 pastes its output; a budget missed on the way is fixed in code by its own `perf` ticket, never by raising the budget (the owner's decision)

## Out of scope
- The quick bench in `Verify` (55-57, 174); new workloads.
- Posting results to `openboard/ops` (dogfooding phase A, setup work).

## Notes
- docs/project.md M15 ("full bench within budgets for 7 nightly runs in both modes"), docs/codebase.md 6.6 (full bench nightly: compiled binary, idle windows, hosted against the runner's Postgres service; a measured value fails only beyond 20% and its noise floor) and 6.7 (`nightly.yml`), docs/architecture.md "Efficiency budgets".
- `gh` reads run results with the workflow's `GITHUB_TOKEN` or the owner's login; the script never prints a token.
- 192 created `nightly.yml`; 274 added the task workload this bench must hold. Changing what the nightly runs is not adding a CI gate, but say in the PR what it adds to the nightly's duration.
- Depends on 237, the last ticket before it to change `.github/workflows/nightly.yml`.
