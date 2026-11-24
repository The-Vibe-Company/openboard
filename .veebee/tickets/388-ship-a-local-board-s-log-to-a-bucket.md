---
id: 388
title: Ship a local board's log to a bucket
milestone: M15-operations
package: app
writes:
  - apps/openboard/src/compose.ts
  - apps/openboard/src/backup.ts
  - apps/openboard/test/local-backup.test.ts
  - packages/driver-sqlite/src/snapshot.ts
  - packages/driver-sqlite/test/snapshot.test.ts
  - docs/codebase.md
conformance: []
modes: [local]
depends_on: [210, 212, 371]
status: draft
claimed_by: null
issue: null
---

## What the user does
As someone running `ob serve` or the self-host container, I set a bucket's five variables and my board's log, files and snapshots are copied off the machine, so losing the disk loses about ten seconds of writes.

## Done when
- [ ] `bun test apps/openboard/test/local-backup.test.ts` passes on SQLite with a fake bucket and a fake clock: 25 posts and one attached file are, 10 s later, in gzip NDJSON segments under `org/<local org id>/` and under `org/<id>/blobs/sha256/<hash>`, each once; each snapshot 212 takes is uploaded once under `org/<id>/snapshots/<UTC time>.sqlite`; without the variables nothing is shipped and the server logs once that shipping is off
- [ ] with MinIO as the bucket (`docker run -d -p 9000:9000 -e MINIO_ROOT_USER=… -e MINIO_ROOT_PASSWORD=… minio/minio server /data`, a bucket made with its console or `mc`, and the five `OPENBOARD_BACKUP_S3_*` variables, the secret key through `OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY_FILE`), `ob serve` then `ob post dev hi` puts a segment in the bucket within 20 s, and the process's argv and log hold no secret

## Out of scope
- Restoring from what was shipped (389); hosted shipping (210, 371).
- Choosing a provider (Q2) or lifecycle rules: the bucket is the operator's.

## Notes
- D25 (local: upload snapshots, ship new log events every 10 s as compressed segments, upload attachments content-addressed, Bun's built-in S3 client), docs/architecture.md "Deployment" ("Local and single-node self-host": log shipping to a bucket when configured).
- Reuse, do not fork: 210's `Bucket` port and `apps/openboard/src/bucket.ts`, its shipping job and segment format (371 adds blobs), registered on the SQLite jobs runner (181) in local mode too; `apps/openboard/src/compose.ts` wires them when the variables are set, whatever the mode.
- Snapshots are the driver's (212, a driver-owned timer): give `snapshot.ts` an `onSnapshot(path)` callback from the composition root, and upload the file in `apps/openboard/src/backup.ts`, streamed, never read whole into memory.
- docs/codebase.md 5.5: say that the `OPENBOARD_BACKUP_S3_*` variables work in both modes.
- **Arrows added:** 210 (the bucket port, the job and the variables) and 371 (blobs in the same job) are not upstream of 212.
