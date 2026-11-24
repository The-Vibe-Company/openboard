---
id: 372
title: Delete files that were never attached
milestone: M13-data-files-schedules
package: server
writes:
  - packages/server/src/jobs/blob-gc.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/test/ha/blob-gc.test.ts
  - packages/server/test/ha/purge-org.test.ts
  - packages/driver-sql/src/views/attachments/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/migrations/0050-attachment-gc.sql
  - packages/driver-sql/migrations/0051-attachment-gc-backfill.sql
  - packages/driver-postgres/src/blobs.ts
  - packages/driver-sqlite/src/blobs.ts
  - packages/driver-sqlite/src/ddl.ts
  - packages/ports/src/attachments/blobs.ts
  - packages/ports/src/jobs.ts
  - packages/ports/src/index.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/isolation-attachments.ts
  - docs/data-model.md
conformance: []
modes: [local, hosted]
depends_on: [181, 367]
status: done
claimed_by: Codex
issue: 567
---

## What the user does
As the owner, a file uploaded but never attached to a message stops taking space a day later, so an agent that uploads and crashes does not fill the organization's stored bytes.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/blob-gc.test.ts` passes with both instances' runners polling: at T + 23 h an unattached upload still exists and can be attached, while a download still answers 404 under the attachment access rule from #562; at T + 24 h exactly one runner removes the row and blob of a file that remains unattached (a download and a new attempt to attach it answer 404 `attachment_not_found`) and gives its bytes back to the organization's stored bytes; an attached file and an unattached one whose bytes another attachment of the organization still uses keep their blob
- [ ] the same file passes on SQLite (`bun test packages/server/test/ha/blob-gc.test.ts`), where the blob's file under `$OPENBOARD_DATA_DIR/blobs/` is gone afterwards, and `bun run bench --quick` shows no timer armed while idle beyond the jobs runner's

## Out of scope
- Removing the objects 371 shipped to the bucket: the bucket keeps them until the organization's purge or the bucket's lifecycle rules.
- Removing files of deleted messages: a deleted message keeps its attachments row (upstream tombstones keep files out of reads).

## Notes
- docs/data-model.md "Attachments", docs/architecture.md "Jobs any instance can take" (blob GC: same pick pattern, idempotent).
- The upload's board write enqueues one GC job due 24 h later through the `Jobs` port (181) for its attachment; the job, under the board lock, deletes the row only if it is still unattached, then deletes the blob if no other row of the organization has its `sha256`. A duplicate pick finds nothing to do.
- Register the kind in `packages/server/src/jobs/registry.ts`; a new job kind is handled by the release before the one that enqueues it (docs/codebase.md 5.7), so the handler and the enqueue ship together here, before any upload in production depends on it.
