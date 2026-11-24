---
id: 277
title: List a board's grants
milestone: M10-access
package: server
writes:
  - packages/contract/src/operations/grants.ts
  - packages/server/src/operations/grants.ts
  - packages/driver-sql/src/views/grants.ts
  - packages/driver-sql/src/statements.ts
  - packages/ports/src/grants.ts
  - packages/ports/testkit/store/grants.test-suite.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/server/test/grants/list.test.ts
  - packages/cli/src/commands/grants.ts
  - packages/cli/test/grants.test.ts
  - packages/contract/src/operations/grants/list.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/server/src/operations/grants/list.ts
  - packages/server/src/operations/index.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/index.ts
  - packages/cli/src/grant-views.ts
  - packages/cli/src/output.ts
  - packages/server/openapi.json
  - skills/openboard/references/commands.md
  - docs/protocol.md
conformance: []
modes: [local, hosted]
depends_on: [276]
status: done
claimed_by: claude-opus-t277
issue: 452
---

## What the user does
As a board owner, I see every grant on the board with `ob grants`: whom each names and what it lets them do.

## Done when
- [x] `ob grants` as the local owner prints one row per unrevoked grant, g1 (`--all-users  all`), g2, g3, each connection's grant and any made with `ob grants create`, as upstream's `vb grants` prints them (`*` alone in words, other patterns as `pattern=permissions`, `none` for a closed one); `ob grants --json` prints `{ grants }`, each with `id`, `principals`, `can`, `capped`, `by` and `at`
- [x] a direct connection whose grant is `dev=all` gets `error: forbidden: …` (no `manage` at `*`), and so does a claimed agent token

## Out of scope
- Revoking (278).

## Notes
- Upstream `GET /grants` ("Needs `manage` at `*`, or a team owner"); docs/auth.md "Routes a claimed token can never reach".
- g1 to g3 are reserved IDs (`next_grant` starts at 4) but no row holds them yet: list them as docs/auth.md describes them (g1 `all-users` `*=all` capped by role; g2 `all-projects`, g3 `all-apps`, letting no one in), seeded as rows by a migration or answered by the view; say which in the PR.
