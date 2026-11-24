---
id: 212
title: Snapshot a local board with VACUUM INTO on schedule
milestone: M7-hosted-deploy
package: driver-sqlite
writes:
  - packages/driver-sqlite/src/snapshot.ts
  - packages/driver-sqlite/src/snapshot-worker.ts
  - apps/openboard/src/compose.ts
  - scripts/build/index.ts
  - packages/driver-sqlite/src/open.ts
  - packages/driver-sqlite/src/migrate.ts
  - packages/driver-sqlite/src/index.ts
  - packages/driver-sqlite/test/snapshot.test.ts
  - docs/decisions.md
conformance: []
modes: [local]
depends_on: [39, 184]
status: done
claimed_by: Codex
issue: 373
---

## What the user does
As someone running a local or self-hosted board on one volume, I find recent consistent copies of my board in the data directory, taken while it kept serving.

## Done when
- [ ] `OPENBOARD_DATA_DIR=/tmp/ob bun apps/openboard/src/main.ts serve`, then `ob post dev hi`: `ls /tmp/ob/backups` lists a snapshot named by its UTC time, and `sqlite3 /tmp/ob/backups/<it> 'select count(*) from events'` answers a number, while the board keeps answering
- [ ] `bun test packages/driver-sqlite/test/snapshot.test.ts` passes with a fake clock and timer: a snapshot is taken at open and every 6 hours, holds every event committed before it, the ninth removes the oldest so eight remain, and opening a data directory with a pending migration first writes `backups/pre-migrate-<version>.sqlite`

## Out of scope
- Uploading snapshots and shipping the log to a bucket in local mode (M15, 388); `openboard restore` (M15, 389).
- Hosted backups (210, 211).

## Notes
- D25 (6-hourly `VACUUM INTO` snapshots, local mode only) and docs/codebase.md 7.6 ("Snapshots are written by a scheduled job (`VACUUM INTO`, D25) and `openboard restore` reads them back"). `VACUUM INTO` runs on the read-only connection, so writes go on meanwhile.
- The schedule is a timer the driver owns (docs/codebase.md 2.2: timers come from the driver in local mode), injected like its clock so the test advances it, and cleared by `close()`. It is not a `Jobs` row: a snapshot is about this one file, not work any instance may take.
- Keeping eight snapshots (two days) is a choice the docs do not make: record it in docs/decisions.md.
- 167 named this ticket for the snapshot before a migration (`packages/driver-sqlite/src/migrate.ts`).
- Depends on 184 because both change `packages/driver-sqlite/src/open.ts`.
