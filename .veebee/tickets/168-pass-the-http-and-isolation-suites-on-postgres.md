---
id: 168
title: Pass the HTTP and isolation suites on Postgres
milestone: M5-postgres-driver
package: server
writes:
  - packages/server/test/support/drivers.ts
  - packages/server/test/support/app.ts
  - packages/server/test/support/env.ts
  - packages/server/package.json
  - packages/driver-postgres/test/isolation.test.ts
  - packages/driver-sql/src/views/**
  - packages/ports/testkit/store/**
  - bun.lock
conformance: []
modes: [local, hosted]
depends_on: [163, 165, 166]
status: draft
claimed_by: null
issue: 248
---

## What the user does
As the owner of the code base, I know no operation lets one organization read or change another's data on Postgres either, and every HTTP behaviour holds there.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/isolation` passes and prints the same number of cases as `bun test packages/server/test/isolation`
- [ ] the `postgres` CI job's command, `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=… bun run --filter @openboard/driver-postgres --filter @openboard/server test`, passes with every server test on one Postgres app and `packages/driver-postgres/test/isolation.test.ts` (the storage twin) among the driver tests
- [ ] with `OPENBOARD_TEST_DRIVER=postgres` and a database URL nothing listens on, the same command exits 1: the suites fail, never skip

## Out of scope
- Two instances behind alternating requests (M6, 177).
- The conformance kit on Postgres (170).
- Expected-failure lists: forbidden (AGENTS.md non-negotiable 15).

## Notes
- docs/codebase.md 6.1 and 6.5; label `isolation`. The `postgres` job in `.github/workflows/ci.yml` already runs `@openboard/server`'s whole test script with `OPENBOARD_TEST_DRIVER=postgres`, and the isolation suite shares `makeApp()` (`packages/server/test/support/app.ts`) with every HTTP test, so turning the store on Postgres for one turns it on for all. That is why this ticket covers the HTTP suites as well as the isolation suites (`.veebee/cut.md` line 168 named only the latter).
- `openStore` in `packages/server/test/support/drivers.ts` returns `postgresDriver` on a fresh database from 162's template harness when `OPENBOARD_TEST_DRIVER=postgres`, read through `packages/server/test/support/env.ts` (166). Keep `makeApp()` synchronous by opening the Postgres store lazily, so no test file changes.
- Storage twin: `packages/driver-postgres/test/isolation.test.ts` runs `packages/ports/testkit/isolation.test-suite.ts` (135) on Postgres, as `packages/driver-sqlite/test/isolation.test.ts` does on SQLite.
- Depends on 165 and 166 as well as 163: 165 may correct `packages/driver-sql/src/views/**` and 166 changes `packages/server/test/support/drivers.ts`, both files this ticket writes.
- A failing isolation case is a security bug: stop and report it. A view that misbehaves on Postgres only is fixed in `packages/driver-sql/src/views/**` with a testkit case that shows it.
