---
id: 363
title: Refuse a built-in's name or an uncheckable definition
milestone: M13-data-files-schedules
package: core
writes:
  - packages/core/src/schemas/definition.ts
  - packages/core/test/schemas/definition.test.ts
  - packages/core/src/schemas/register.ts
  - packages/server/test/schemas/refuse.test.ts
  - packages/core/src/index.ts
  - packages/contract/src/operation.ts
  - packages/server/src/operations/schemas/registry.ts
  - packages/contract/src/operations/schemas/registry.ts
  - packages/server/openapi.json
  - skills/openboard/SKILL.md
  - skills/openboard/references/commands.md
  - docs/protocol.md
  - tools/conformance/score.json
conformance: ["schemas/refuses a built-in's name, and a definition it couldn't check a value against"]
modes: [local, hosted]
depends_on: [362]
status: done
claimed_by: codex
issue: 558
---

## What the user does
As a board admin, registering a definition the board could not check a value against, or a new version of a built-in, is refused with a message naming the keyword and where it is.

## Done when
- [ ] `ob schemas create git-commit@2 --data '{"type":"object"}'` prints `error: reserved_schema: …`; `--data '{"type":"string"}'`, `'{"type":"object","properties":{"next":{"$ref":"#"}}}'`, `'{"type":"object","properties":{"id":{"type":"string","pattern":"^(a+)+$"}}}'` and `'{"type":"object","properties":{"ids":{"type":"array","uniqueItems":true}}}'` each print `error: invalid_schema: …` naming the keyword and its path, and nothing is registered
- [ ] `bun test packages/core/test/schemas/definition.test.ts` passes: every structural keyword of upstream's table is accepted, any other is refused, and a definition over 32 KB of JSON, 512 nodes (each `enum` and `const` value counting), 64 subschemas or 16 levels deep is refused; `bun test packages/server/test/schemas/refuse.test.ts` passes on SQLite and Postgres
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `schemas/refuses a built-in's name, and a definition it couldn't check a value against`, recorded with `--update` under `local` and `hosted`

## Out of scope
- Checking a value against a definition (364).
- The stricter checks of Vercel's registry (a `required` name `properties` does not declare, a type keyword without its `type`): upstream's own server does not make them.

## Notes
- Upstream `docs/04-reference/03-http.md` "Schemas" (the keyword table, the formats `date-time`, `date`, `time`, `email`, `uri`, `uuid`, `hostname`, `ipv4`, `ipv6`, and the size limits) and `checkDefinition` in `@vercel/board/schemas` (`dist/schemas.mjs`). Only `tools/conformance` may import `@vercel/board` (docs/codebase.md 3.1), so core writes its own `definition.ts`; 364 adds a parity test against upstream's functions.
- `reserved_schema` (409) wins over every other check for a built-in's name; a caller without `manage` at `*` still gets 403 first, which the kit reads as "this token can't register schemas".
