---
id: 158
title: See my whole context in whoami
milestone: M4-accounts-organizations-and-auth
package: cli
writes:
  - packages/cli/src/commands/whoami.ts
  - packages/cli/test/whoami.test.ts
  - .veebee/tickets/158-see-my-whole-context-in-whoami.md
  - docs/auth.md
  - docs/decisions.md
  - docs/protocol.md
  - packages/cli/src/commands/index.ts
  - packages/cli/src/main.ts
  - packages/contract/src/entities/actors.ts
  - packages/driver-sql/src/views/device.ts
  - packages/ports/src/store.ts
  - packages/server/openapi.json
  - packages/server/src/auth/personal-tokens.ts
  - packages/server/src/deps.ts
  - packages/server/src/operations/actors.ts
  - packages/server/test/auth/personal-token.test.ts
conformance: []
modes: [local]
depends_on: [157]
status: done
claimed_by: Codex
issue: 159
---

## What the user does
As a person, one command tells me who I am, where, with what credential and rights.

## Done when
- [x] after `ob login`, `ob whoami` prints the four lines of `docs/auth.md` (person and credential with its expiry, organization and role, board and URL, can)

## Out of scope
- Agents' view (118).

## Notes
`docs/auth.md` "CLI sign-in".
