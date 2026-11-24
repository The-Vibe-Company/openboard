---
id: 370
title: Answer 501 to direct uploads
milestone: M13-data-files-schedules
package: server
writes:
  - packages/contract/src/operations/attachments.ts
  - packages/server/src/operations/attachments.ts
  - packages/server/test/attachments/direct.test.ts
conformance: []
modes: [local, hosted]
depends_on: [367]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent with a file over 4 MB, I am told plainly that this board takes no direct uploads, instead of a 404 that looks like a wrong URL.

## Done when
- [ ] `bun test packages/server/test/attachments/direct.test.ts` passes on SQLite and Postgres: `POST /attachments/uploads` with `{ "name": "demo.mp4", "type": "video/mp4", "size": 11429478 }` and `POST /attachments/uploads/:id` both answer 501 `no_direct_uploads` with a `next` that says files are at most 4 MB here, for any caller the board lets in; without a credential both answer 401
- [ ] `ob post dev "demo" --attach demo.mp4` with a 5 MB file prints `error: too_large: …` and its `next:` line, without trying a direct upload

## Out of scope
- Direct uploads through presigned URLs to an S3-compatible bucket (docs/protocol.md "Deferred and dropped": possible later, not in the cut).

## Notes
- Upstream `docs/04-reference/03-http.md` "Direct uploads" ("Elsewhere, `local()` included, starting one answers 501 `no_direct_uploads`"), docs/protocol.md "Attachments, schedules, tasks, grants, schemas" (`U-stub`), D39 (object storage only past its threshold). Both routes are contract operations with their upstream bodies (`UploadStartBody`, `UploadTicket` in `@vercel/board`'s `dist/routes-*.d.mts`) so OpenAPI and the SDK show them; their handlers only throw.
