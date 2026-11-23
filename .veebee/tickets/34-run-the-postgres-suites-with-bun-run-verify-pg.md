---
id: 34
title: Run the Postgres suites with bun run verify:pg
milestone: M0-foundations
package: tools
writes:
  - docker-compose.test.yml
  - scripts/ci/verify-pg.ts
  - package.json
conformance: []
modes: [hosted]
depends_on: [31]
status: ready
claimed_by: null
issue: 34
---

## What the user does
As a contributor touching storage, I run the same suites on a real Postgres with one command.

## Done when
- [ ] `bun run verify:pg` starts Postgres with `docker compose -f docker-compose.test.yml up -d` (or uses `OPENBOARD_TEST_DATABASE_URL`), runs the Postgres test run and `bun run conformance --driver postgres --instances 2`, and exits 0
- [ ] with `OPENBOARD_TEST_DRIVER=postgres` and an unreachable `OPENBOARD_TEST_DATABASE_URL`, it exits 1: tests fail, never skip

## Out of scope
- The CI jobs (35).
- The template-database harness and `makeApp()` on two instances: with the Postgres driver (M5, 162; M6, 176).

## Notes
`docs/codebase.md` 6.2 (real Postgres only, same major version as production, pinned in `docker-compose.test.yml` and `ci.yml`).
