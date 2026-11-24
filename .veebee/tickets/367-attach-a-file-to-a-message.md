---
id: 367
title: Attach a file to a message
milestone: M13-data-files-schedules
package: server
writes:
  - packages/contract/src/operation.ts
  - packages/contract/src/entities/attachments.ts
  - packages/contract/src/operations/attachments.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/entities/messages.ts
  - packages/core/src/attachments/upload.ts
  - packages/core/test/attachments/upload.test.ts
  - packages/core/src/messages/post.ts
  - packages/core/src/index.ts
  - packages/ports/src/blobs.ts
  - packages/ports/src/index.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/blobs.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/driver-sql/migrations/*-attachments.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/attachments.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/views/purge.ts
  - packages/driver-sqlite/src/blobs.ts
  - packages/driver-sqlite/src/index.ts
  - packages/driver-sqlite/test/testkit.test.ts
  - packages/driver-postgres/src/blobs.ts
  - packages/driver-postgres/src/index.ts
  - packages/driver-postgres/test/testkit.test.ts
  - packages/server/src/operations/attachments.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/http/router.ts
  - packages/server/src/http/openapi.ts
  - packages/server/src/app.ts
  - packages/server/test/attachments/upload.test.ts
  - packages/server/test/support/drivers.ts
  - packages/server/test/isolation/seed.ts
  - packages/sdk/src/client.ts
  - packages/cli/src/commands/attach.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/test/attach.test.ts
  - apps/openboard/src/compose.ts
  - tools/conformance/src/drivers.ts
  - tools/bench/src/drivers.ts
conformance: ["attachments/takes a file, posts it, and gives it back"]
modes: [local, hosted]
depends_on: [296, 305, 339, 364]
status: draft
claimed_by: null
issue: 562
---

## What the user does
As an agent, I attach a screenshot to a post with `ob post dev "after the fix" --attach after.png`, and anyone who can read the thread gets the same bytes back with `ob download <id>`.

## Done when
- [ ] `ob post dev "after the fix" --attach after.png` uploads the file, then posts with its ID; `ob read <id> --json` shows `attachments: [{ id: "at_…", name: "after.png", type: "image/png", size }]`; `ob download at_… out.png` writes bytes equal to `after.png`; `curl -si "$BOARD_URL/attachments/at_…" -H @auth.header` (a file holding the `authorization` header, so the token stays off argv) answers with `content-security-policy: sandbox`, `x-content-type-options: nosniff`, `cache-control: private, max-age=31536000, immutable` and `content-disposition: inline` (a `.zip` answers `attachment`)
- [ ] `bun test packages/server/test/attachments/upload.test.ts` passes on SQLite (files under `$OPENBOARD_DATA_DIR/blobs/`) and on Postgres (`OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard`, rows in `blobs`): a file over 4 MB answers 413 `too_large`, an empty one 400 `invalid_request`, a post naming an ID never stored answers as upstream's `local()` does, a download needs read in the channel of a message that carries it (404 `attachment_not_found` otherwise, and for another organization's ID), the same bytes uploaded by two organizations are stored once per organization, and attachment bytes count toward the organization's stored bytes (197)
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `attachments/takes a file, posts it, and gives it back`, recorded with `--update` under `local` and `hosted`; `runBlobsSuite` passes on both drivers

## Out of scope
- Refusing a dotfile name (368); files on a task (369); `/attachments/uploads` (370).
- Shipping blobs to the backup bucket (371); removing blobs never attached (372); files on a schedule (373 stores their IDs).

## Notes
- Upstream `POST /attachments` and `GET /attachments/:id` (`docs/04-reference/03-http.md` "Attachments": the body is the file, `content-type` its type, `x-board-filename` its URI-encoded name, at most 4 MB; a post names up to 10 IDs; images, MP4, WebM and plain text inline). docs/data-model.md "Attachments" and `attachments`, D39, docs/codebase.md 2.2 (`ports/src/blobs.ts`, `driver-sqlite/src/blobs.ts`, `driver-postgres/src/blobs.ts`, `testkit/blobs.test-suite.ts`).
- **Why both drivers here.** The cut had hosted storage in 371, but a check recorded under `local` only fails lint (171: the hosted list may not be shorter), so this ticket lands the `Blobs` port with the filesystem driver (local, temp file then rename) and the Postgres `bytea` driver (hosted, `INSERT … ON CONFLICT DO NOTHING` into `blobs`), keyed `org/<org_id>/sha256/<hash>`, never shared across organizations. 371 then ships new blobs to the backup bucket.
- Upload: read the body while hashing (never more than 4 MB held), write the blob, then record the `attachments` row (`attached = 0`) in a board write; the post's fold marks it attached and adds `^` terms (docs/data-model.md "How folds are derived"). The `blobs` table carries `org_id`: list it in `packages/driver-sql/src/views/purge.ts` (208).
- The contract has no raw-body operation yet: add one input kind to `defineOperation` (`packages/contract/src/operation.ts`) for a byte body with a size cap and for a streamed answer, so the router, OpenAPI (`application/octet-stream`) and the SDK (`upload(bytes, { name, type })`, `download(id)`) follow from the contract (docs/codebase.md 4); no hand-written route.
- Every composition root passes the new port to `createApp` (`packages/server/src/app.ts` `Ports`), as 181 did for `Jobs`. `ob post … --attach` and `ob download <id> [path]` are hand-written in `packages/cli/src/commands/attach.ts` (upstream `vb --attach`, `vb download`).
- An attachment ID (`at_` + 26 base32 characters, docs/data-model.md "IDs") is the `file` `Ref` kind: seed one in `packages/server/test/isolation/seed.ts`.
- Depends on 364 (`packages/core/src/messages/post.ts`, `packages/core/src/index.ts`), 339 (`packages/server/src/http/router.ts`), 305 (`apps/openboard/src/compose.ts`) and 296 (`packages/server/src/app.ts`), the last tickets before it to change those files.

Orchestrator note: the dependency on 215 (serving production) was dropped: it ordered milestones, it is not a technical need, and 215 waits on the owner's production secrets.
