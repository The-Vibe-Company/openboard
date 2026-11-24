---
id: 211
title: Take a daily pg_dump
milestone: M7-hosted-deploy
package: driver-postgres
writes:
  - packages/driver-postgres/src/dump.ts
  - packages/driver-postgres/src/index.ts
  - packages/driver-postgres/test/dump.test.ts
  - packages/ports/src/store.ts
  - packages/server/src/jobs/dump.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/test/ha/dump.test.ts
  - Dockerfile
conformance: []
modes: [hosted]
depends_on: [210]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the owner of the hosted service, every day a full dump of the database lands in the bucket, so account and operational tables can be restored even if Railway's volume backups are gone.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres/test/dump.test.ts` passes: the driver's dump of a seeded test database, restored with `pg_restore` into a fresh database, holds the same rows in every table
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/dump.test.ts` passes with a fake bucket and both runners polling: one dump per UTC day is written to `dumps/<YYYY-MM-DD>.dump`, by exactly one instance, and a missed day is taken once when the runners come back, not once per missed day
- [ ] `docker run --rm --entrypoint pg_dump openboard:dev --version` prints the same major version as the Postgres pinned in `docker-compose.test.yml`

## Out of scope
- Restoring from a dump (M15, 390, 391).
- Dump retention in the bucket: the bucket's lifecycle rules, set by the owner.

## Notes
- docs/architecture.md "Backups and recovery" (a daily `pg_dump` to the same bucket from the job runner), D38. The dump runs `pg_dump --format=custom` with `Bun.spawn` inside `packages/driver-postgres` (the only workspace that holds the database URL, passed through the environment of the child, never its argv) and streams it to the `Bucket` port of 210 without holding it in memory.
- The image gains the Postgres client of the pinned major version (docs/codebase.md 7.2); say in the PR what that adds to the image size.
- Depends on 210, which lands the bucket.
