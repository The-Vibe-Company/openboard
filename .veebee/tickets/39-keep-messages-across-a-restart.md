---
id: 39
title: Keep messages across a restart
milestone: M1-walking-skeleton
package: driver-sqlite
writes:
  - packages/driver-sqlite/src/open.ts
  - packages/driver-sqlite/src/migrate.ts
  - packages/driver-sqlite/test/open.test.ts
  - apps/openboard/src/config.ts
  - apps/openboard/src/compose.ts
conformance: []
modes: [local]
depends_on: [36]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a developer, I stop and restart my local board and nothing I posted is gone.

## Done when
- [ ] `ob serve`, `ob post dev hello`, stop the server, start it again: `ob read dev` still prints `#1  hello`
- [ ] `sqlite3 .openboard/board.db 'select org_id, board_id, id, type from events'` prints `1|1|1|message.posted`

## Out of scope
- Snapshots and backups (M7, M15).
- Postgres (M5).

## Notes
`docs/data-model.md` "Pragmas (SQLite)" and `schema_migrations`; default `OPENBOARD_DATA_DIR=./.openboard` (`docs/codebase.md` 5.5).
