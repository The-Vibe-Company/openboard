---
id: 167
title: Migrate once under an advisory lock with openboard migrate
milestone: M5-postgres-driver
package: app
writes:
  - packages/driver-postgres/src/migrate.ts
  - packages/driver-postgres/src/index.ts
  - packages/driver-postgres/test/migrate.test.ts
  - apps/openboard/src/main.ts
  - apps/openboard/src/migrate.ts
  - apps/openboard/src/compose.ts
  - apps/openboard/test/migrate.test.ts
  - docs/architecture.md
conformance: []
modes: [hosted]
depends_on: [162]
status: claimed
claimed_by: claude-t167
issue: 247
---

## What the user does
As an operator deploying several instances at once, I run `openboard migrate` before they start and the schema is migrated exactly once.

## Done when
- [ ] `OPENBOARD_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun apps/openboard/src/main.ts migrate` on an empty database prints each migration it applies and exits 0; run again, it prints that the schema is current and exits 0
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres/test/migrate.test.ts` passes: two migrators started together on one empty database both resolve, `schema_migrations` lists each version once, and the second waited on the lock instead of failing

## Out of scope
- An instance refusing readiness when its minimum schema is newer than the database's (M6, 184).
- Railway's pre-deploy command running it (M6, 189).
- The contract-phase rules for destructive migrations, already enforced by `scripts/ci/migrations.ts` (31).
- SQLite's `VACUUM INTO` snapshot before migrating (M7, 212).

## Notes
- docs/architecture.md "Migrations without downtime", D36, D42: `pg_advisory_lock(<constant>)` on a dedicated session held for the whole run, then `pg_advisory_unlock`; it is the one session-level lock the failover rules allow (docs/architecture.md "Upgrade path to a failover database"). The constant is named in `migrate.ts`.
- Hosted `openboard serve` (162) migrates at start through the same locked function, so two containers of a self-hosted HA install never race either; `openboard migrate` exists for the deploy's pre-start step.
- `migrate` is a server command, handled in `apps/openboard/src/main.ts` before handing argv to `runCli`; the driver is reached only through `compose.ts` (the composition root), so `migrate.ts` asks `compose.ts` for the migration, never imports the driver.
- Without `OPENBOARD_DATABASE_URL`, `openboard migrate` opens the local data directory, which `sqliteDriver` migrates on open (`packages/driver-sqlite/src/migrate.ts`).
- The database URL never appears in output or logs.
