---
id: 410
title: Wake the job runner at the next due job without extra reads
milestone: M9-tasks
package: ports
writes:
  - packages/ports/src/jobs.ts
  - packages/ports/testkit/jobs.test-suite.ts
  - packages/driver-sql/src/views/jobs/index.ts
  - packages/driver-sqlite/src/jobs.ts
  - packages/driver-postgres/src/jobs.ts
  - packages/driver-postgres/src/broadcaster.ts
  - packages/server/src/jobs/registry.ts
  - bun.lock
  - docs/architecture.md
  - docs/codebase.md
  - docs/data-model.md
  - docs/decisions.md
  - packages/driver-postgres/package.json
  - packages/driver-postgres/src/index.ts
  - packages/driver-postgres/test/jobs.test.ts
  - packages/driver-postgres/test/testkit.test.ts
  - packages/driver-postgres/test/unavailable.test.ts
  - packages/driver-sql/migrations/0026-job-notifications.sql
  - packages/driver-sql/migrations/0027-purge-tombstone-notifications.sql
  - packages/driver-sql/src/ddl.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/views/jobs/legacy-purge.ts
  - packages/driver-sql/src/views/jobs/purge.ts
  - packages/driver-sql/src/views/jobs/wake.ts
  - packages/driver-sql/src/views/memberships.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sqlite/src/ddl.ts
  - packages/driver-sqlite/src/migrate.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/driver-sqlite/test/testkit.test.ts
  - packages/ports/src/index.ts
  - packages/ports/testkit/index.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/ports/testkit/store/orgs.test-suite.ts
  - packages/server/test/ha/drain.test.ts
  - packages/server/test/ha/jobs.test.ts
  - packages/server/test/ha/purge-org.test.ts
  - packages/server/test/ha/ship-log.test.ts
conformance: []
modes: [local, hosted]
depends_on: []
status: done
claimed_by: Codex
issue: 744
---

## What the user does
As an operator, a job enqueued for later (a task claim's expiry, a purge) runs when it falls due, on any instance, while an idle server keeps no polling timer and an enqueue costs no extra database read.

## Done when
- [ ] The shared job suite passes via `bun test packages/driver-sqlite/test/testkit.test.ts` and `bun test packages/driver-postgres/test/testkit.test.ts` (`OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard`): a job enqueued with a due time in the future is run once the fake clock reaches it, by the enqueuing instance and, on Postgres, by another instance; with no job pending the runner arms no timer; enqueuing a job that falls due before the armed one rearms the timer earlier
- [ ] `bun run bench --quick` and `bun run bench --mode hosted --quick` report the same statements and round trips as main for every operation, and zero idle timers

## Out of scope
- Task claim expiry itself (245, which builds on this).

## Notes
Split from ticket 245 (#418, 2026-11-24): keeping the runner's timer at the earliest due job by reading the queue after each enqueue added a statement to task create, claim and completion. Carry the due time with the enqueue instead: on SQLite the in-process enqueue hands its `dueAt` to the runner; on Postgres the `INSERT` notifies with the due time in its payload (in the same statement, as `setHead` does with `pg_notify`), and each instance's runner keeps the earliest known due time and rearms one timer. A runner starting up or catching up after a reconnect reads the earliest due time once.
