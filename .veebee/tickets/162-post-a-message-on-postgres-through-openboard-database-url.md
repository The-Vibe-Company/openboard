---
id: 162
title: Post a message on Postgres through OPENBOARD_DATABASE_URL
milestone: M5-postgres-driver
package: driver-postgres
writes:
  - docs/decisions.md
  - packages/driver-sql/src/ddl.ts
  - packages/driver-sqlite/src/ddl.ts
  - packages/driver-postgres/src/concurrent-indexes.ts
  - packages/driver-postgres/src/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-postgres/src/pool.ts
  - packages/driver-postgres/src/dialect.ts
  - packages/driver-postgres/src/migrate.ts
  - packages/driver-postgres/src/broadcaster.ts
  - packages/driver-postgres/src/database.ts
  - packages/driver-postgres/test/testkit.test.ts
  - packages/driver-postgres/test/support/env.ts
  - packages/driver-postgres/package.json
  - packages/driver-postgres/tsconfig.json
  - packages/ports/testkit/index.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - apps/openboard/src/config.ts
  - apps/openboard/src/compose.ts
  - apps/openboard/src/serve.ts
  - apps/openboard/test/config.test.ts
  - apps/openboard/package.json
  - apps/openboard/tsconfig.json
  - .oxlintrc.json
  - bun.lock
conformance: []
modes: [local, hosted]
depends_on: [35, 135]
status: done
claimed_by: codex
issue: 242
---

## What the user does
As an operator, I point the server at a Postgres database and a message posted there is stored in it.

## Done when
- [ ] with the test Postgres up (`docker compose -f docker-compose.test.yml up -d --wait`), `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres` runs the store testkit's message cases on Postgres (a post read back by its ID and in its channel) and passes; without `OPENBOARD_TEST_DRIVER`, `bun run verify` still passes with no Docker
- [ ] `OPENBOARD_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun apps/openboard/src/main.ts serve` starts instead of exiting 2, writes no owner token file, and `docker compose -f docker-compose.test.yml exec postgres psql -U openboard -tAc 'select version from schema_migrations order by 1'` then prints the number of every migration in `packages/driver-sql/migrations/`

## Out of scope
- The other testkit suites on Postgres (163); the row-lock race (164).
- The advisory lock and `openboard migrate` (167).
- HTTP and isolation suites on Postgres (168); creating an organization in hosted mode (169).
- Fast 503 `unavailable` and connection timeouts (172).
- Cross-instance wake-ups: this ticket's broadcaster wakes only the instance that wrote (M6, 176).
- Listening on all interfaces for a container (188).

## Notes
- `postgresDriver({ url })` mirrors `sqliteDriver` (`packages/driver-sqlite/src/open.ts`): build a `Db` (`packages/driver-sql/src/db.ts`) over Bun's `SQL` (`query` with positional values, `transaction` over `sql.begin`), the `postgres` dialect, then `createViews(db, dialect)` from `@openboard/driver-sql`. The shared registry is already written in Postgres text (`postgresText` in `db.ts`); the dialect's `lockSuffix` makes `boardStatements.lockBoard` (`packages/driver-sql/src/views/boards.ts`) a `FOR UPDATE`.
- Bun's client returns `BIGINT` as strings (D32); the views already decode with `Number(...)`.
- Migrations: `packages/driver-sql/migrations/*.sql` are Postgres syntax and run unrendered; record each in `schema_migrations` as `packages/driver-sqlite/src/migrate.ts` does, each in its own transaction. Migration 0001 seeds `local/main` on both engines; hosted mode mints no local owner token, so nothing can reach that board there.
- Broadcaster: whatever shape 97 gave the port and `packages/driver-sqlite/src/broadcaster.ts`, the Postgres driver returns the same, publishing after commit to this instance's subscribers only, so `compose.ts` can build an app.
- Config (`apps/openboard/src/config.ts`): replace the "hosted mode on Postgres is not built yet" refusal with a `databaseUrl`, accepted from `OPENBOARD_DATABASE_URL` or `OPENBOARD_DATABASE_URL_FILE` (both set is an error, as for the secret key); the URL holds a password, so it is never logged or printed. Set means `mode: "hosted"` (docs/codebase.md 5.5); `compose.ts` picks the driver; `serve.ts` writes the owner token file in local mode only.
- `database.ts` holds the test-database harness of docs/codebase.md 6.2 (migrate a template once per run, `CREATE DATABASE t_<random> TEMPLATE …` per test file, drop after). It is SQL, so it lives in this driver, exported for the composition roots that need it later (168, 170, 173). Two `bun test` processes may build the template at once (`bun run --filter` runs workspaces in parallel): take an advisory lock or give each process its own template name.
- Env in tests: `.oxlintrc.json` refuses `process.env` in `packages/**`. Add one narrow override for `packages/*/test/support/env.ts`, the only files that read `OPENBOARD_TEST_DRIVER` and `OPENBOARD_TEST_DATABASE_URL`; the PR names this lint change. Driver tests run only when `OPENBOARD_TEST_DRIVER=postgres` (the `unit-sqlite` job has no database) and fail, never skip, when it is set and the database is unreachable.
- Export each area suite from `packages/ports/testkit/index.ts` next to `runStoreSuite`, so this ticket can run `messagesSuite` alone.
