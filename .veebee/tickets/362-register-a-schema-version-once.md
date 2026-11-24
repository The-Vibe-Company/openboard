---
id: 362
title: Register a schema version once
milestone: M13-data-files-schedules
package: server
writes:
  - packages/core/src/schemas/register.ts
  - packages/core/src/schemas/canonical.ts
  - packages/core/test/schemas/register.test.ts
  - packages/core/src/index.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/schemas.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/driver-sql/migrations/*-schemas.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/schemas.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/views/purge.ts
  - packages/server/src/operations/schemas.ts
  - packages/server/test/schemas/register.test.ts
  - packages/server/test/isolation/seed.ts
  - packages/cli/src/commands/schemas.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/test/schemas.test.ts
  - docs/data-model.md
conformance: ["schemas/registers a schema version once: the same definition again changes nothing, and another is refused"]
modes: [local, hosted]
depends_on: [361]
status: draft
claimed_by: null
issue: 557
---

## What the user does
As a board admin, I register `sandbox@1` once with `ob schemas create sandbox@1 --file sandbox.schema.json --description 'What a sandbox did.'`, and running it again changes nothing.

## Done when
- [ ] `ob schemas create sandbox@1 --file sandbox.schema.json --description 'What a sandbox did.'` prints the schema with outcome `created`; the same command with the definition's keys in another order prints `unchanged`; another definition or another description prints `error: schema_immutable: …` and exits 1; `ob schemas` then lists `sandbox@1` once, after the built-ins, with `by` and an ISO `at`
- [ ] `bun test packages/server/test/schemas/register.test.ts` passes on SQLite and on Postgres (`OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard`): registering needs `manage` at `*` (a member capped by role gets 403 `forbidden`), an unknown body key answers 400 `invalid_request`, the 501st version on a board answers 400 `too_many_schemas`, a schema registered on one board is not on another board of the same organization, and the board's audit lists `ob.schema.registered`
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `schemas/registers a schema version once: the same definition again changes nothing, and another is refused`, recorded with `--update` under `local` and `hosted`

## Out of scope
- Refusing a built-in's name and checking the definition's keywords and sizes (363): here a definition only needs a root `"type": "object"`.
- Narrowed callers (365); blocks (364).

## Notes
- Upstream `POST /schemas` (`docs/04-reference/03-http.md` "Schemas": `{ schema, created }`, sameness on the definition whatever its key order and on the description, 409 `schema_immutable`, strict body, 500 versions per board), docs/data-model.md `schemas`, D23 (board configuration is an `ob.*` event, never on `/events`).
- Registering appends `ob.schema.registered`, folded into `schemas` (migration, next free number, `packages/driver-sql/migrations/`, plus the hand-written list in `packages/driver-sql/src/index.ts`); the fold dispatch lives in `appendEvent` (`packages/driver-sql/src/views/messages.ts`). docs/data-model.md's `schemas` has no `org_id`, which D33 ("tenancy keys everywhere") and 208's purge need: add the column, correct docs/data-model.md in this PR, and list the table in `packages/driver-sql/src/views/purge.ts` (208's testkit case fails otherwise).
- `packages/core/src/schemas/canonical.ts` serializes a definition with sorted keys, so the comparison and the stored text do not depend on the order a client sent.
- A schema is a `Ref` kind already (`packages/contract/src/operation.ts`); seed one in `packages/server/test/isolation/seed.ts`.
- `ob schemas create <id> (--file <path> | --data <json>) [--description <text>]` is hand-written (upstream `vb schemas create`, `docs/04-reference/01-cli.md` "schemas"): `--file -` reads stdin; `--json` prints `{ schema, outcome }`.
