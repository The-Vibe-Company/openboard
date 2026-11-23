---
id: 173
title: Record the hosted bench baseline
milestone: M5-postgres-driver
package: tools
writes:
  - tools/bench/src/**
  - tools/bench/budgets.json
  - tools/bench/test/**
  - tools/bench/package.json
  - packages/driver-postgres/src/counters.ts
  - packages/driver-postgres/src/pool.ts
  - packages/driver-postgres/src/index.ts
  - packages/driver-postgres/test/counters.test.ts
  - .github/workflows/ci.yml
  - bun.lock
conformance: []
modes: [local, hosted]
depends_on: [170, 172]
status: draft
claimed_by: null
issue: 253
---

## What the user does
As a contributor, I see how fast a hosted board posts and reads on Postgres, recorded as the numbers to hold.

## Done when
- [ ] `OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun run bench --quick --mode hosted` runs the post, reply and channel-read workloads on two instances sharing one fresh Postgres database and prints p50, p99 and statements per operation
- [ ] `tools/bench/budgets.json` holds them under `hosted`, never looser than the hosted targets in `docs/architecture.md` "Efficiency budgets", and `bun run bench --quick` (both modes) passes in the CI `bench` job

## Out of scope
- Round trips per write (174).
- 50 SSE tails across instances (M6: not in the cut; see the PR that wrote this ticket).
- The full bench against staging's database, nightly (M6, 192).

## Notes
- docs/codebase.md 6.6, D41; mirror 55 (`tools/bench/src/drivers.ts`, `packages/driver-sqlite/src/counters.ts`). `drivers.ts` says hosted mode runs on SQLite "until the Postgres driver exists"; boot `postgresDriver` there on a fresh database from 162's template harness, two instances as `instancesPerMode` already says.
- The statement counter counts every statement the store sends, `BEGIN` and `COMMIT` included, as SQLite's does.
- The CI `bench` job has no Postgres service today; give it the same service container and `OPENBOARD_TEST_DATABASE_URL` as the `postgres` job (docs/codebase.md 6.7 already says this job runs both modes' counters). The PR names this change to `.github/workflows/ci.yml`.
- Depends on 172 because both change `packages/driver-postgres/src/pool.ts`.
