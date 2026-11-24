---
id: 390
title: Restore a hosted organization from its backups
milestone: M15-operations
package: app
writes:
  - apps/openboard/src/restore.ts
  - apps/openboard/test/restore-org.test.ts
  - packages/driver-postgres/src/restore.ts
  - packages/driver-postgres/src/index.ts
  - packages/driver-postgres/test/restore.test.ts
  - packages/driver-sql/src/views/restore.ts
  - packages/driver-sql/src/statements.ts
conformance: []
modes: [hosted]
depends_on: [210, 211, 389]
status: draft
claimed_by: null
issue: 585
---

## What the user does
As the operator, I bring back one organization from the bucket without touching any other, `openboard restore --org acme`, and after losing the database volume I bring back everything from the last dump plus the log shipped since.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres/test/restore.test.ts` passes with a fake bucket: with organizations A and B shipped, A's rows removed by its purge (208, slug kept), `openboard restore --org <A>` rebuilds A's boards, organization events, memberships and blobs so that A's isolation digest (docs/codebase.md 6.5) equals the one before, and B's digest is unchanged; a restore into an organization that still holds rows exits 2 and changes nothing
- [ ] in the same file: a database restored with `pg_restore` from 211's dump of time T, then `openboard restore --after-dump`, holds every event shipped after T for every organization, each once; running it twice adds nothing
- [ ] `apps/openboard/test/restore-org.test.ts` passes: the command reads the database URL and the bucket from the environment only, and prints per organization how many events it replayed

## Out of scope
- The drill on staging and its numbers (391); local mode (389).
- Sessions, device codes and pending webhook deliveries, which a restore may lose (docs/architecture.md "Backups and recovery" says so).

## Notes
- docs/architecture.md "Backups and recovery" (segments "restore one organization without touching others"; RPO about 10 s after volume loss; account and operational tables from the last `pg_dump` or Railway backup), D38, D40.
- Same replay as 389 (`packages/driver-sql/src/views/restore.ts`, folding through `views/fold.ts`), with each board's lock taken on Postgres; IDs are log positions, so replayed events keep their IDs and cursors stay valid (D9). An organization's events go back under its own `org_id`; nothing from the bucket can name another organization (the key prefix decides, and the replay checks every event's `org_id`).
- The dump of 211 is restored with the provider's or Postgres's own tools; this ticket adds only the replay after it. Say in `--help` which dump time it reads (the dump's name, `dumps/<YYYY-MM-DD>.dump`, and the segments' positions recorded with it).
- **Arrow added:** 389, which lands the shared replay and `apps/openboard/src/restore.ts`.
