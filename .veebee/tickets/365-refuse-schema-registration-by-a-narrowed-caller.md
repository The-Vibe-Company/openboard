---
id: 365
title: Refuse schema registration by a narrowed caller
milestone: M13-data-files-schedules
package: server
writes:
  - packages/server/test/schemas/narrowed.test.ts
conformance: ["schemas/refuses a caller narrowed with x-board-can a schema, and lets it read them"]
modes: [local, hosted]
depends_on: [286, 362]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board admin who hands an agent a narrowed credential, I know it can read the schemas but cannot register one, whatever its credential could do unnarrowed.

## Done when
- [ ] `bun test packages/server/test/schemas/narrowed.test.ts` passes on SQLite and Postgres: with the local owner's token and `x-board-can: dev=read,post`, `GET /schemas` lists `git-commit@1` and `POST /schemas` answers 403 `forbidden` naming `manage` and registers nothing; a claimed agent token pinned to `dev=read,post` gets the same answers; without the header the owner registers
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `schemas/refuses a caller narrowed with x-board-can a schema, and lets it read them`, recorded with `--update` under `local` and `hosted`

## Out of scope
- Narrowing itself (286, 287); narrowed callers on watchers (302), webhooks (325) and sync's records (M14).

## Notes
- Upstream: registering needs `manage` at `*` (`docs/04-reference/03-http.md` "Permissions"); the kit narrows with `withCan` (`dist/conformance-*.mjs`, `narrowedOut`). With 362 checking `manage` at `*` through `keepInsideCan` (`packages/server/src/auth/access.ts`), the check may already pass once 286 has landed: then this ticket adds the test and records the check, nothing more. If it fails, the cause is in how 362 checks `manage`, fixed there in `packages/server/src/operations/schemas.ts` (add the file to `writes` in the PR).
