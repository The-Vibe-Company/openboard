---
id: 166
title: Compare both engines' schemas
milestone: M5-postgres-driver
package: driver-postgres
writes:
  - packages/driver-sqlite/src/catalog.ts
  - packages/driver-sqlite/package.json
  - packages/driver-postgres/src/catalog.ts
  - packages/driver-postgres/package.json
  - packages/server/test/support/drivers.ts
  - packages/server/test/support/env.ts
  - packages/server/package.json
  - packages/server/tsconfig.json
  - bun.lock
  - packages/server/test/schema-parity.test.ts
conformance: []
modes: [local, hosted]
depends_on: [163]
status: claimed
claimed_by: claude-opus-166
issue: 246
---

## What the user does
As a contributor, a migration that leaves the two engines with different tables, columns or keys fails CI.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/schema-parity.test.ts` migrates a fresh SQLite and a fresh Postgres database, reads both catalogs, and passes when they hold the same tables, columns (name, nullability) and primary keys
- [ ] on a scratch branch, a migration edited so a column exists only on Postgres (for example inside a statement the SQLite renderer drops) makes the same command fail naming the table and the column

## Out of scope
- Column types: they differ by the mechanical mapping of docs/data-model.md "DDL", which `scripts/ci/migrations.ts` already checks (65).
- Indexes, extensions and the trigram index: engine-only by design (docs/data-model.md "DDL").
- `EXPLAIN` of statements (165).

## Notes
- docs/data-model.md "The store port", point 3: `pragma_table_info` on SQLite, `information_schema.columns` and the primary-key constraints on Postgres. The catalog queries are SQL, so each lives in its driver (`src/catalog.ts`) behind a `./catalog` subpath export in the driver's `package.json`; `schema_migrations` is compared too.
- Only composition roots may import both drivers (`scripts/ci/boundaries.json` "drivers"), so the comparison runs through `packages/server/test/support/drivers.ts`, which exposes both catalogs to the test. The test runs only when `OPENBOARD_TEST_DRIVER=postgres` (the `postgres` CI job).
- `packages/server/test/support/env.ts` reads `OPENBOARD_TEST_DRIVER` and `OPENBOARD_TEST_DATABASE_URL` (the lint override of 162); `@openboard/driver-postgres` becomes a dev dependency of `packages/server`. 168 waits for this ticket, since both change `packages/server/test/support/drivers.ts`.
