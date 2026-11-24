---
id: 207
title: Soft-delete an organization
milestone: M7-hosted-deploy
package: server
writes:
  - packages/contract/src/index.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/contract/src/operations/audit.ts
  - packages/driver-sql/src/views/memberships.ts
  - packages/server/src/operations/audit.ts
  - packages/server/src/operations/events.ts
  - packages/ports/src/index.ts
  - packages/ports/src/org-audit-record.ts
  - packages/server/test/isolation/isolation.test.ts
  - packages/server/test/isolation/cases.ts
  - docs/decisions.md
  - packages/contract/src/operations/orgs.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/entities/orgs.ts
  - packages/core/src/orgs/delete.ts
  - packages/core/src/index.ts
  - packages/core/test/orgs/delete.test.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/orgs.test-suite.ts
  - packages/driver-sql/src/views/orgs.ts
  - packages/driver-sql/src/views/boards.ts
  - packages/driver-sql/test/actors.test.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/orgs.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/http/scope.ts
  - packages/server/test/orgs-delete.test.ts
  - packages/server/test/isolation/seed.ts
  - packages/server/openapi.json
  - docs/protocol.md
conformance: []
modes: [local, hosted]
depends_on: [155, 170, 203]
status: done
claimed_by: codex
issue: 368
---

## What the user does
As the owner of an organization, I delete it, and from that moment nobody reaches its boards, while its data is kept 30 days.

## Done when
- [x] signed in as the owner, `curl -b cookies -H 'x-ob-csrf: <csrf>' -H 'origin: <public URL>' -X POST <public URL>/api/x/orgs/acme/delete` answers `{ org, deletedAt, purgeAt }` with `purgeAt` 30 days later and records `ob.org.deleted`; an admin who is not an owner gets 403 `forbidden`
- [x] `bun test packages/server/test/orgs-delete.test.ts` passes on SQLite and, with `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard`, on Postgres: after the deletion, `GET /api/acme/main/me` answers 404 `not_found` to a member's session, a personal token, a connection secret, and an agent token of `acme/main`, `GET /api/x/me` lists no `acme` membership, the person can create a new organization, and the slug `acme` stays taken
- [x] in the same file, a second delete answers 404 `not_found`, and the other organization's boards answer as before

## Out of scope
- Removing the rows 30 days later (208); deleting one board (209).
- Exporting an organization before deleting it (M15, 392); undoing a deletion (not planned).

## Notes
- docs/architecture.md "SaaS seams" (organization deletion: soft delete, sign-in blocked, data kept 30 days), docs/protocol.md route inventory (`POST /api/x/orgs/:org/delete`, owner), docs/data-model.md (`orgs.deleted_at`), D40, D49 (organization writes take the `orgs` row lock and number an `ob.*` organization event).
- The tenant resolver stops resolving a deleted organization (`packages/server/src/http/scope.ts`), so every board route, credential and membership check under it answers as for an unknown organization in one place: this touches tenant scoping, so the PR carries the label `isolation`. The isolation seed gains a deleted organization whose routes must answer like an unknown slug.
- The slug stays reserved after the deletion (Q7: immutable slugs, `BOARD_URL`s in agents' environments must never point at someone else's board); a membership of a deleted organization no longer counts for the one-organization rule (138).
- Depends on 203 because both change `packages/server/src/operations/orgs.ts`, and on 155, the last ticket before it to change `packages/server/src/http/scope.ts`.
