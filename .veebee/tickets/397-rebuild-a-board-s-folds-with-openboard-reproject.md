---
id: 397
title: Rebuild a board's folds with openboard reproject
milestone: M15-operations
package: driver-sql
writes:
  - apps/openboard/src/compose.ts
  - apps/openboard/src/main.ts
  - apps/openboard/src/reproject.ts
  - apps/openboard/test/reproject.test.ts
  - docs/codebase.md
  - docs/data-model.md
  - docs/decisions.md
  - packages/driver-postgres/src/catalog.ts
  - packages/driver-postgres/test/testkit.test.ts
  - packages/driver-sql/migrations/0059-imported-head.sql
  - packages/driver-sql/migrations/0060-reproject-job-guards.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/projection-version.ts
  - packages/driver-sql/src/purge-test-data.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/boards.ts
  - packages/driver-sql/src/views/grants.ts
  - packages/driver-sql/src/views/inbound/index.ts
  - packages/driver-sql/src/views/messages/fold.ts
  - packages/driver-sql/src/views/orgs.ts
  - packages/driver-sql/src/views/reproject/index.ts
  - packages/driver-sql/src/views/webhooks/webhooks.ts
  - packages/driver-sql/test/actors.test.ts
  - packages/driver-sqlite/src/catalog.ts
  - packages/driver-sqlite/src/ddl.ts
  - packages/driver-sqlite/src/import.ts
  - packages/driver-sqlite/test/reproject.test.ts
  - packages/driver-sqlite/test/testkit.test.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/index.ts
  - packages/ports/testkit/store/reproject.test-suite.ts
  - packages/server/test/reproject.test.ts
  - skills/openboard/SKILL.md
  - tools/conformance/src/drivers.ts
  - tools/conformance/src/run.ts
conformance: []
modes: [local, hosted]
depends_on: [389]
status: done
claimed_by: root
issue: 592
---

## What the user does
As the operator after a release that changes how events fold, I rebuild a board's derived tables from its log with `openboard reproject acme/main`, and every read answers as if the board had always been folded the new way.

## Done when
- [ ] `openboard reproject acme/main` (hosted, `OPENBOARD_DATABASE_URL` set) and `openboard reproject` (local) rebuild every fold table of the board from its `events`, under the board's lock, print the events replayed and the time taken, and set `boards.projection` to the release's projection version; a local board whose recorded version is older is rebuilt at start before the server answers
- [ ] `bun test packages/server/test/reproject.test.ts` passes on SQLite and Postgres: after the full conformance run's writes on a board, a reprojection leaves every fold table (the `view` columns included) byte for byte as it was; a write sent during the rebuild waits for the lock and lands after it; another board is untouched
- [ ] `runStoreSuite`'s reprojection cases pass on both drivers, including a board with several hundred thousand events replayed in batches without holding them all in memory

## Out of scope
- Rebuilding a large hosted board online into new tables while the old ones keep serving (docs/data-model.md "Reprojection" describes it; no line of the cut builds it yet, and the PR says whether a board of the size measured needs it).
- Compaction (398); restore (389, 390).

## Notes
- docs/data-model.md "How folds are derived" (one deterministic fold per event type; time from `event.at`) and "Reprojection" (`boards.projection`; local: rebuild at boot, target ≥ 50,000 events/s; a test replays the conformance run's log and compares `view` columns byte for byte), docs/codebase.md 2.2 (`apps/openboard/src/reproject.ts`).
- Folds go through the dispatcher 389 split out of `appendEvent` (`packages/driver-sql/src/views/messages/fold.ts`). **Arrow added:** 389, so the split lands once and both restore and reprojection use it.
- Every fold must be deterministic for the byte comparison to hold: a fold that reads the clock or anything outside the event and current state is a bug this ticket fixes (name each one in the PR).
- The projection version is a constant in `driver-sql`, raised by any PR that changes a fold.
- Depends on 393, the last ticket before it to change `apps/openboard/src/main.ts`.

Orchestrator note (2026-11-24): the dependency on the deferred Railway ticket(s) [215] was dropped; this ticket does not need a deployment.

Orchestrator note (2026-11-24): dropped file-ordering dependency on 393 (apps/openboard/src/main.ts).

Decision on #592 (2026-11-25): import records `boards.imported_head` via an additive migration.
Reprojection applies the shared import predicate to positions through that boundary and the full
fold dispatcher to later events. Regression coverage checks that archived policy stays inactive.
