---
id: 371
title: Ship new files to the backup bucket
milestone: M13-data-files-schedules
package: server
writes:
  - packages/server/src/jobs/ship-log.ts
  - packages/server/test/ha/ship-blobs.test.ts
  - packages/driver-sql/src/views/shipping.ts
  - packages/driver-sql/src/statements.ts
  - packages/ports/src/store.ts
  - docs/decisions.md
conformance: []
modes: [hosted]
depends_on: [210, 324, 367]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the owner, a file someone attaches on the hosted service is in the backup bucket within seconds, next to its organization's log, so losing the database volume loses no file the log mentions.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/ship-blobs.test.ts` passes with a fake bucket and both instances' runners polling: two files uploaded in organization A are, once the fake clock has moved 10 s, under `org/<A's id>/blobs/sha256/<hash>` with the same bytes, each written once though both runners ran; the same bytes uploaded by organization B land under B's prefix only; a second run writes nothing; A's purge (208) removes A's blob objects with its prefix
- [ ] with the owner's bucket configured on staging (210's `OPENBOARD_BACKUP_S3_*`), `ob post dev "shot" --attach shot.png` on staging puts `org/<id>/blobs/sha256/<hash>` in the bucket within 20 s, listed with the provider's own tool

## Out of scope
- Storing files in Postgres, which 367 does; restoring them (390); local mode (388).
- Moving blobs to an S3-compatible `Blobs` driver past D39's threshold (no line of the cut; a later ticket when blob bytes near 20 GB).

## Notes
- **Retitled.** The cut's line was "Store attachments in Postgres"; that work moved into 367 (a check recorded only under `local` fails 171's lint), so this line takes the work 210 left to M13: "Shipping attachment blobs: they arrive with attachments (M13) and use the same job". docs/architecture.md "Backups and recovery" step 1 ("new attachment blobs are shipped the same way").
- Extend 210's job (`packages/server/src/jobs/ship-log.ts`): each organization's shipped position also covers `attachments` rows by creation, so a blob is put once, keyed by its content address; an object already in the bucket is not put again. Blobs are read through the `Blobs` port (367), never from the database directly.
- docs/decisions.md: D26's status line says hosted attachments go to S3-compatible storage, which contradicts D39 (Postgres `bytea`, object storage past a threshold) and docs/data-model.md "Attachments": correct the status line to point at D39.
- Owner: the bucket and its credentials (Q2), as for 210; the second criterion is checked once they exist.
- Depends on 210 for the bucket and its job, and on 324, the last ticket before it to change docs/decisions.md.
