---
id: 209
title: Soft-delete a board
milestone: M7-hosted-deploy
package: server
writes:
  - packages/contract/src/operations/boards.ts
  - packages/core/src/orgs/boards.ts
  - packages/core/test/orgs/boards.test.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/boards.test-suite.ts
  - packages/driver-sql/src/views/orgs.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/boards.ts
  - packages/server/src/http/scope.ts
  - packages/server/test/boards-delete.test.ts
  - packages/server/openapi.json
  - docs/decisions.md
conformance: []
modes: [local, hosted]
depends_on: [208]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an organization admin, I delete a board I no longer use, and its URL, connections and agents stop working at once.

## Done when
- [ ] signed in as an admin, `curl -b cookies -H 'x-ob-csrf: <csrf>' -H 'origin: <public URL>' -X POST <public URL>/api/x/orgs/acme/boards/ops/delete` answers `{ board, deletedAt }` and records `ob.board.deleted`; `GET /api/x/orgs/acme/boards` no longer lists `ops`; a member gets 403 `forbidden`
- [ ] `bun test packages/server/test/boards-delete.test.ts` passes on SQLite and on Postgres (`OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard`): after the deletion, every route under `/api/acme/ops` answers 401 `unauthorized` to the board's connection secret and agent tokens and 404 `not_found` to a member's session, the board `main` still answers, and creating a board with slug `ops` again answers 409 `slug_taken`
- [ ] in the same file, deleting `main` answers 400 `invalid_request` with a hint to delete the organization instead, and changes nothing

## Out of scope
- Removing a deleted board's rows: they go with the organization's purge (208).
- The settings page that offers this (M8, 233 creates boards; deleting one from the page is not planned).

## Notes
- docs/protocol.md route inventory (`POST /api/x/orgs/:org/boards/:board/delete`, admin, soft delete), docs/data-model.md (`ob.board.deleted` organization event), D49 (the organization's row lock and event numbering).
- The tenant resolver skips a deleted board as it skips a deleted organization (207), so the change is in one place (`packages/server/src/http/scope.ts`); the PR carries the label `isolation`.
- `main` is the default board (docs/auth.md "Organizations, boards, people"): `/:org` opens it (docs/architecture.md "Front routes") and `ob login` stores it as the CLI's board (156), so it goes only with its organization (207). docs/protocol.md names no code for this; the catalog's `invalid_request` is used, and the rule is recorded in docs/decisions.md.
- Depends on 208 because both change `packages/driver-sql/src/views/orgs.ts`.
