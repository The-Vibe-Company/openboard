---
id: 210
title: Ship each organization's log to the bucket every 10 seconds
milestone: M7-hosted-deploy
package: server
writes:
  - packages/ports/src/bucket.ts
  - packages/ports/src/jobs.ts
  - packages/ports/src/index.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/driver-sql/migrations/*-shipping.sql
  - packages/driver-sql/src/views/jobs/shipping.ts
  - packages/driver-sql/src/views/jobs/purge.ts
  - packages/driver-sql/src/views/jobs/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/jobs/ship-log.ts
  - packages/server/src/jobs/purge-org.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/src/app.ts
  - packages/server/src/http/scope.ts
  - packages/server/test/ha/ship-log.test.ts
  - packages/server/test/isolation/seed.ts
  - apps/openboard/src/bucket.ts
  - apps/openboard/src/config.ts
  - apps/openboard/src/compose.ts
  - apps/openboard/test/config.test.ts
  - docs/codebase.md
conformance: []
modes: [hosted]
depends_on: [199, 208]
status: done
claimed_by: codex
issue: 371
---

## What the user does
As the owner of the hosted service, losing the database volume costs at most about ten seconds of events, because each organization's new events are in the bucket within ten seconds.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/ship-log.test.ts` passes with a fake bucket and both instances' runners polling: 25 posts on two boards of organization A and one organization event are, once the fake clock has moved 10 s, in gzip NDJSON segments under `org/<A's id>/` whose events equal each board's log in order, each once; a second run ships nothing; nothing of organization B lands under A's prefix; and A's purge (208) deletes A's prefix
- [ ] with the owner's bucket configured on staging (`OPENBOARD_BACKUP_S3_ENDPOINT`, `_BUCKET`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`), a post on staging appears in a segment under `org/<id>/` within 20 s, listed with the provider's own tool; without those variables the instance starts, ships nothing, and logs once that shipping is off

## Out of scope
- The daily `pg_dump` (211); restoring an organization from its segments (M15, 390); exporting one (M15, 392).
- Shipping attachment blobs: they arrive with attachments (M13) and use the same job.
- Log shipping in local mode (M15, 388).

## Notes
- docs/architecture.md "Backups and recovery" (segments every 10 s under `org/<org_id>/…`, compressed NDJSON, Bun's built-in S3 client; segments double as the export format), D38, Q2 (provider: the owner's call; Cloudflare R2 is recommended).
- A `Bucket` port (`packages/ports/src/bucket.ts`: put, list, delete a prefix) keeps I/O out of the server; the composition root implements it over Bun's `S3Client` in `apps/openboard/src/bucket.ts`, and tests pass an in-memory fake (no network beyond the test database). `Ports` in `packages/server/src/app.ts` gains it; it is optional, and the job is not registered without it.
- Each board's shipped position lives in a table (migration, next free number) so any instance continues where another stopped; a segment's key is derived from its board and its first and last positions, so shipping the same range twice writes the same object.
- Config: the five `OPENBOARD_BACKUP_S3_*` variables, the secret key also as `_FILE`, never logged (docs/codebase.md 5.5, D42); all or none set, else exit 2 naming them.
- Owner first: the bucket and its credentials (Q2), set as staging's and production's variables. Agents cannot create them; the second criterion is checked once they exist.
- Depends on 199, which also changes `packages/server/src/app.ts`, and on 208, whose purge this ticket extends to the bucket.
