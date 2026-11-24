---
id: 165
title: EXPLAIN every registered statement on both engines
milestone: M5-postgres-driver
package: driver-sql
writes:
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sqlite/test/explain.test.ts
  - packages/driver-postgres/test/explain.test.ts
conformance: []
modes: [local, hosted]
depends_on: [163]
status: done
claimed_by: claude-t165
issue: 245
---

## What the user does
As a contributor, a statement one engine cannot parse fails CI even when no test reaches it.

## Done when
- [ ] `bun test packages/driver-sqlite/test/explain.test.ts` and `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres/test/explain.test.ts` each run one case per entry of `statements` (named after it) on a migrated database, and both pass
- [ ] on a scratch branch, a registered statement no testkit case runs, with a misspelt column, makes both files fail naming that statement

## Out of scope
- Comparing the two catalogs (166).
- Reading query plans for index use: the bench counts statements and round trips (173, 174).

## Notes
- docs/data-model.md "The store port", point 2; docs/codebase.md 3.3 point 5.
- The registry (`packages/driver-sql/src/statements.ts`) exports each statement's text rendered for Postgres only; also export the `Statement` objects (or a render per dialect) so the SQLite test can `EXPLAIN` the `?` form. The registry stays the one list the tenant-filter test (`packages/driver-sql/test/statements.test.ts`) reads.
- Bind `NULL` for every parameter. Where Postgres cannot infer a parameter's type, add an explicit cast in the statement (`packages/driver-sql/src/views/**`), never a per-engine exception list.
- Each test runs in its own driver's workspace, so it builds its `Db` from its own `src/` and needs no other driver.
- 168 waits for this ticket, since both may correct statements in `packages/driver-sql/src/views/**`.

Orchestrator note: `packages/driver-sql/src/views/**` was dropped from `writes` so M3 tickets can run alongside. If a statement's plan needs a fix (an index or a rewritten query), change only that view file, add it to `writes` in your branch and name it in the PR; the orchestrator resolves overlaps at merge.
