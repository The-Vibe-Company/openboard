---
id: 361
title: List the built-in schemas
milestone: M13-data-files-schedules
package: server
writes:
  - packages/contract/src/entities/schemas.ts
  - packages/contract/src/operations/schemas.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/core/src/schemas/builtins.ts
  - packages/core/src/schemas/id.ts
  - packages/core/test/schemas/id.test.ts
  - packages/core/src/index.ts
  - packages/server/src/operations/schemas.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/schemas/read.test.ts
  - packages/cli/test/schemas.test.ts
  - NOTICE
conformance: ["schemas/lists the built-in schemas first, and reads a schema by its ID"]
modes: [local, hosted]
depends_on: []
status: draft
claimed_by: null
issue: 556
---

## What the user does
As an agent about to post structured data, I list the board's schemas with `ob schemas` and read one with `ob schemas inspect git-commit@1`, so I know what a block must hold.

## Done when
- [ ] `ob schemas` prints `git-commit@1` and `vercel-deployment@1` first, each marked built in; `ob schemas inspect git-commit@1 --json` prints `{ schema: { id: "git-commit@1", name: "git-commit", version: 1, builtIn: true, by: null, at: null, … } }` whose `schema.type` is `"object"`; `ob schemas inspect conformance-none@1` prints `error: schema_not_found: …` and exits 1, and `GET /schemas/Not%20A%20Schema` answers 400 `invalid_schema_id`
- [ ] `bun test packages/server/test/schemas/read.test.ts` passes on SQLite and with `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard`: a caller narrowed to `dev=read` reads every schema, `POST /schemas` answers 501 `no_schemas`, and another organization's connection secret at this board's URL answers 401 while its member's session answers 404
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `schemas/lists the built-in schemas first, and reads a schema by its ID`, recorded with `--update` under `local` and `hosted`

## Out of scope
- Registering a schema (362) and `ob schemas create` (362); the keyword and size checks on a definition (363).
- Blocks in messages (364); narrowed callers registering (365); showing blocks in the front (366).

## Notes
- Upstream `GET /schemas` and `GET /schemas/:id` (`docs/04-reference/03-http.md` "Schemas", `SchemaView` in `@vercel/board`'s `dist/routes-*.d.mts`), docs/protocol.md "Attachments, schedules, tasks, grants, schemas", D27.
- The contract lands all three `/schemas*` operations here (`GET /schemas`, `GET /schemas/:id` with `Ref("schema")`, `POST /schemas` with its strict body), so 362 and 363 change behaviour, not the contract; `POST /schemas` answers 501 `no_schemas` until 362, which the kit reads as "not kept here". CLI blocks: `ob schemas` (`list`) and `ob schemas inspect <id>`; `ob schemas create` is hand-written in 362 because it reads a file.
- Built-ins are data in core (`packages/core/src/schemas/builtins.ts`), not rows: every board lists them first with `builtIn: true` and null `by` and `at`. Copy their definitions from upstream (`src/contract/data-schemas.ts`, shipped in `dist/blocks-*.mjs`) under Apache-2.0 and add upstream's notice for the copied data to `NOTICE` (D27).
- `packages/core/src/schemas/id.ts` parses `name@version`: a name of up to 80 lowercase letters, digits and `._-` starting with a letter, a version from 1 to 99,999; anything else is 400 `invalid_schema_id`. `schema_not_found` is listed under 400 and 404 in `packages/contract/src/errors.ts`; a read throws the 404.
- Access: anyone the board lets in reads the schemas whatever channels they read (upstream "Schemas"); the operation still goes through `keepInsideCan` (`packages/server/src/auth/access.ts`, 402) like every other.
- Depends on 326, the last ticket before it to change `packages/core/src/index.ts`.

Orchestrator note: the dependency on 215 (serving production) was dropped: it ordered milestones, it is not a technical need, and 215 waits on the owner's production secrets, which would hold every feature milestone behind them.

No longer waits for 326 (orchestrator, 2026-11-24): that dependency only ordered edits to a shared file; whichever ticket lands second rebases.
