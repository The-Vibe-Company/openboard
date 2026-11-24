---
id: 397
title: Rebuild a board's folds with openboard reproject
milestone: M15-operations
package: driver-sql
writes:
  - packages/driver-sql/src/views/reproject.ts
  - packages/driver-sql/src/statements.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/reproject.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/driver-sqlite/src/open.ts
  - apps/openboard/src/reproject.ts
  - apps/openboard/src/main.ts
  - apps/openboard/test/reproject.test.ts
  - packages/server/test/reproject.test.ts
conformance: []
modes: [local, hosted]
depends_on: [215, 389, 393]
status: draft
claimed_by: null
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
- Folds go through the dispatcher 389 split out of `appendEvent` (`packages/driver-sql/src/views/fold.ts`). **Arrow added:** 389, so the split lands once and both restore and reprojection use it.
- Every fold must be deterministic for the byte comparison to hold: a fold that reads the clock or anything outside the event and current state is a bug this ticket fixes (name each one in the PR).
- The projection version is a constant in `driver-sql`, raised by any PR that changes a fold.
- Depends on 393, the last ticket before it to change `apps/openboard/src/main.ts`.
