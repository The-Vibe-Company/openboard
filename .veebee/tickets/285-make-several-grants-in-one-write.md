---
id: 285
title: Make several grants in one write
milestone: M10-access
package: server
writes:
  - packages/contract/src/operations/grants.ts
  - packages/core/src/access/grant-changes.ts
  - packages/core/test/access/grant-changes.test.ts
  - packages/core/src/access/lockout.ts
  - packages/core/test/access/lockout.test.ts
  - packages/server/src/operations/grants.ts
  - packages/server/test/grants/batch.test.ts
  - packages/server/test/isolation/cases.ts
  - packages/cli/src/commands/grants.ts
  - packages/cli/test/grants.test.ts
  - docs/protocol.md
  - packages/cli/src/commands/usage.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operation.ts
  - packages/contract/src/operations/grants/batch.ts
  - packages/contract/src/operations/grants/create.ts
  - packages/contract/src/operations/index.ts
  - packages/server/openapi.json
  - packages/server/src/operations/grants/authority.ts
  - packages/server/src/operations/grants/batch.ts
  - packages/server/src/operations/grants/create.ts
  - packages/server/src/operations/index.ts
  - skills/openboard/references/commands.md
  - tools/conformance/score.json
conformance: ["grants/makes several grants in one write, or none of them, a lock with the grant that keeps its maker in"]
modes: [local, hosted]
depends_on: [284]
status: done
claimed_by: Codex
issue: 460
---

## What the user does
As a board owner, I close a pattern to everyone and keep myself in with one write, `ob grants create --file grants.json`, all or none.

## Done when
- [ ] `ob grants create --file grants.json` with an everyone lock and the grant that keeps its maker in makes both in one write and prints a row each, in the order given; `--file -` reads stdin
- [ ] a file whose second grant has the pattern `ops/*/ci` prints `error: invalid_grant: …` and `ob grants` lists none of it; 17 grants print `error: invalid_request: …`
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `grants/makes several grants in one write, or none of them, a lock with the grant that keeps its maker in`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Narrowed callers' batches (288).

## Notes
Upstream `POST /grants/batch { grants, lockMeOut? }`: 1 to 16, each needing what `POST /grants` needs on the grants as they are, `everyone` and a lockout judged with all of them made; answers `{ grants }` in order.
