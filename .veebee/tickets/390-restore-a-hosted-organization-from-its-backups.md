---
id: 390
title: Restore a hosted organization from its backups
milestone: M15-operations
package: app
writes:
  - apps/openboard/src/compose.ts
  - apps/openboard/src/restore.ts
  - packages/driver-postgres/src/restore.ts
  - packages/driver-postgres/src/index.ts
  - packages/driver-postgres/test/restore.test.ts
  - packages/driver-sql/src/views/restore/hosted.ts
  - packages/driver-sql/src/statements.ts
  - apps/openboard/test/restore-org.test.ts
  - packages/driver-postgres/src/restore-backup.ts
  - packages/driver-sql/src/views/restore/index.ts
  - packages/driver-sql/src/views/boards.ts
  - packages/driver-sql/src/views/jobs/shipping.ts
  - packages/driver-sql/src/index.ts
  - packages/ports/src/bucket.ts
  - packages/ports/src/index.ts
  - packages/server/src/app.ts
  - packages/server/src/jobs/ship-log.ts
  - packages/server/src/jobs/export-archive.ts
  - packages/server/test/ha/ship-log.test.ts
  - packages/driver-sql/test/statements.test.ts
  - docs/codebase.md
  - docs/decisions.md
  - skills/openboard/SKILL.md
conformance: []
modes: [hosted]
depends_on: [210, 211, 389]
status: done
claimed_by: codex
issue: 585
---

## What the user does
As the operator, I bring back one organization from the bucket without touching any other, `openboard restore --org acme`, and after losing the database volume I bring back everything from the last dump plus the log shipped since.

## Done when
- [x] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres/test/restore.test.ts` passes with a fake bucket: with organizations A and B shipped, A's database rows removed to simulate database-only loss (keeping the organization slug and its bucket prefix intact), `openboard restore --org <A>` rebuilds A's boards, organization events, memberships and blobs so that A's isolation digest (docs/codebase.md 6.5) equals the one before, and B's digest is unchanged; a restore into an organization that still holds rows exits 2 and changes nothing
- [x] in the same file: a database restored with `pg_restore` from 211's dump of time T, then `openboard restore --after-dump`, holds every event shipped after T for every organization, each once; running it twice adds nothing
- [x] `apps/openboard/test/restore-org.test.ts` passes: the command reads the database URL and the bucket from the environment only, and prints per organization how many events it replayed

## Out of scope
- Changes to hosted hard purge, which continues to delete the organization's bucket prefix.
- The drill on staging and its numbers (391); local mode (389).
- Sessions, device codes and pending webhook deliveries, which a restore may lose (docs/architecture.md "Backups and recovery" says so).

## Notes
- Hosted log shipping publishes a versioned organization board manifest that preserves the ID-to-slug mapping, including empty boards. A pre-manifest backup requires a restored Postgres dump with the relevant board mappings.
- docs/architecture.md "Backups and recovery" (segments "restore one organization without touching others"; RPO about 10 s after volume loss; account and operational tables from the last `pg_dump` or Railway backup), D38, D40.
- Same replay as 389 (`packages/driver-sql/src/views/restore/index.ts`, folding through `views/messages/fold.ts`), with each board's lock taken on Postgres; IDs are log positions, so replayed events keep their IDs and cursors stay valid (D9). An organization's events go back under its own `org_id`; nothing from the bucket can name another organization (the key prefix decides, and the replay checks every event's `org_id`).
- The dump of 211 is restored with the provider's or Postgres's own tools; this ticket adds only the replay after it. Say in `--help` which dump time it reads (the dump's name, `dumps/<YYYY-MM-DD>.dump`, and the segments' positions recorded with it).
- **Arrow added:** 389, which lands the shared replay and `apps/openboard/src/restore.ts`.
