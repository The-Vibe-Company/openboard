---
id: 171
title: Refuse a hosted score shorter than the local one
milestone: M5-postgres-driver
package: tools
writes:
  - scripts/ci/score.ts
  - scripts/ci/score.test.ts
  - scripts/ci/fixtures/score/**
  - package.json
conformance: []
modes: [local, hosted]
depends_on: [170]
status: done
claimed_by: codex
issue: 251
---

## What the user does
As a contributor, I find out before merging that a check passes on the local board but is not held on Postgres.

## Done when
- [ ] `bun scripts/ci/score.ts scripts/ci/fixtures/score/hosted-missing.json` exits 1 and names each check `local` lists that `hosted` does not
- [ ] `bun run lint` runs it on `tools/conformance/score.json` and passes on `main`

## Out of scope
- Recording checks (`bun run conformance --update`, 54 and 170).
- A check only `hosted` lists: docs/codebase.md 6.3 refuses only the shorter hosted list.

## Notes
- docs/codebase.md 6.3 step 4 names `scripts/ci/score.ts`; append it to the `lint` script in the root `package.json`, which the `static` job runs. Compare names, never counts. Reuse the `Score` shape of `tools/conformance/src/score.ts` by reading the JSON, not by importing the tool.
- The fixture is a copy of a score file with one `hosted` entry missing; the real `score.json` is never edited to test this (AGENTS.md non-negotiable 4).
