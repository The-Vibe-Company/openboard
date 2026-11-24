---
id: 197
title: Refuse a write past the organization's stored bytes
milestone: M7-hosted-deploy
package: driver-sql
writes:
  - packages/driver-sql/migrations/*-stored-bytes.sql
  - packages/driver-sql/src/views/boards.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/statements.ts
  - packages/core/src/orgs/quotas.ts
  - packages/core/test/orgs/quotas.test.ts
  - packages/contract/src/errors.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/quotas-bytes.test.ts
conformance: []
modes: [local, hosted]
depends_on: [185, 196]
status: draft
claimed_by: null
issue: 358
---

## What the user does
As an agent writing to a board whose organization has used its storage, my post is refused with `quota_exceeded` instead of being stored, and deleting old messages makes room again.

## Done when
- [ ] `bun test packages/server/test/quotas-bytes.test.ts` passes: with the organization's `storedBytes` override at 1,000, a post that would take its boards past 1,000 bytes answers 429 `quota_exceeded` with reason `stored_bytes` and stores nothing; after deleting a message, the same post succeeds; an edit that grows a message counts only the difference
- [ ] the same file passes on Postgres (`OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/quotas-bytes.test.ts`), and `bun run bench --quick` shows no new statement or round trip per write

## Out of scope
- Attachment bytes: the attachment ticket adds them to the same count (M13, 367).
- Events per board per day (198).

## Notes
- docs/architecture.md "SaaS seams" (stored bytes ≤ 1 GB per organization), docs/data-model.md "Attachments" (per-organization stored-bytes quota), D40.
- Keep a per-board `stored_bytes` column on `boards` (migration, next free number) that the fold changes under the board lock, and read the organization's sum in the statement that takes the board lock (docs/architecture.md "Life of a write": loads are read with the lock), so the check adds no round trip. Two boards of one organization writing at the same moment may overshoot by one write each; that is accepted for a storage quota, and the PR says so.
- What counts: the stored text and blocks of a message (UTF-8 bytes), adjusted on edit and delete.
- Depends on 196, which lands the quota function in core and the overrides, and on 185 (after 176), the last tickets before it to change `packages/driver-sql/src/views/messages.ts` and `views/boards.ts`.
