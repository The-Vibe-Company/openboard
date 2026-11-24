---
id: 392
title: Export an organization
milestone: M15-operations
package: server
writes:
  - packages/contract/src/operation.ts
  - packages/contract/src/entities/exports.ts
  - packages/contract/src/operations/exports.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/orgs/export.ts
  - packages/core/test/orgs/export.test.ts
  - packages/ports/src/store.ts
  - packages/driver-sql/migrations/*-exports.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/exports.ts
  - packages/server/src/operations/exports.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/jobs/export-org.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/test/ha/export-org.test.ts
  - packages/server/test/isolation/seed.ts
  - packages/cli/src/commands/export.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/test/export.test.ts
  - docs/protocol.md
conformance: []
modes: [hosted]
depends_on: [210]
status: draft
claimed_by: null
issue: 587
---

## What the user does
As an organization owner leaving the hosted service, or moving to my own server, I ask for an export with `ob org export`, and a few minutes later download one archive of all my boards' history and files.

## Done when
- [ ] `ob org export` prints the export's ID and `pending`; once ready, `ob org export download <id> --out acme.tar.gz` writes an archive holding `manifest.json` (organization, boards, positions, format version), the organization's events and each board's events as the gzip NDJSON segments of log shipping, and every blob under `blobs/sha256/<hash>`; after 24 h the download prints `error: not_found: …`
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/export-org.test.ts` passes with a fake bucket and both runners polling: the archive is built once; its events equal each board's log in order; no secret hash, token hash, signing secret or session is in it (the connections are listed by name, marked to be re-created); only the organization's owners may request and download (an admin or member gets 403 `forbidden`), another organization's export ID answers 404, and requesting and downloading are in the organization's audit
- [ ] without a configured bucket, `POST /api/x/orgs/:org/exports` answers 501 `not_supported` with a `next` naming the `OPENBOARD_BACKUP_S3_*` variables

## Out of scope
- Importing the archive into `ob serve` (393); exporting from local mode (the data directory and 388's bucket already are the board).
- Exporting one board, or exporting on a schedule.

## Notes
- docs/architecture.md "SaaS seams" (organization export: NDJSON of every board's events and organization events plus blobs, the same format as log shipping, importable into `ob serve`; owner can request it as a job; download link valid 24 h), docs/codebase.md 4.5 and 7.6 ("Moving from local to Postgres is an organization export and import"), D40.
- Routes (OpenBoard-only, under `/api/x/orgs/:org`, recorded in docs/protocol.md "Route inventory: accounts and organizations"): `POST …/exports` (202 `{ export }`), `GET …/exports/:id`, `GET …/exports/:id/download` (streamed through the app: the API never redirects, D8). The archive is built by a job (`packages/server/src/jobs/export-org.ts`, registered in `jobs/registry.ts`) into the bucket under `exports/<org_id>/<id>.tar.gz`, from the segments 210 already shipped plus what is newer, and the blobs (371). Its object is deleted after 24 h by the same job's second run.
- An export ID is a new `Ref` kind (`export`, `packages/contract/src/operation.ts`); seed one in `packages/server/test/isolation/seed.ts`. Event payloads that carry hashes (`ob.connection.*`, `ob.agent.*`) are written with those fields removed (`packages/core/src/orgs/export.ts`), so 393 knows to re-create credentials.
- Owner first: the bucket (Q2), as for 210.
- Depends on 383, the last ticket before it to change docs/protocol.md.

No longer waits for 383 (orchestrator, 2026-11-24): that dependency only ordered edits to a shared file; whichever ticket lands second rebases.
