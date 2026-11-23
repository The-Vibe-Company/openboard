---
id: 112
title: Write as a named profile
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/headers.ts
  - packages/contract/test/headers.test.ts
  - packages/server/src/auth/chain.ts
  - packages/server/test/auth/profile.test.ts
  - packages/contract/src/index.ts
  - packages/contract/src/entities/messages.ts
  - packages/contract/src/entities/actors.ts
  - packages/contract/package.json
  - packages/contract/tsconfig.json
  - bun.lock
  - packages/core/src/access/connections.ts
  - packages/core/test/access/connections.test.ts
  - packages/core/src/messages/post.ts
  - packages/server/src/deps.ts
  - packages/server/src/auth/connections.ts
  - packages/server/src/auth/author.ts
  - packages/server/src/http/openapi.ts
  - packages/server/src/operations/actors.ts
  - packages/server/src/operations/messages.ts
  - packages/server/src/operations/events.ts
  - packages/server/openapi.json
  - packages/sdk/src/client.ts
  - packages/cli/src/config.ts
  - packages/cli/src/main.ts
  - packages/cli/src/output.ts
  - packages/cli/test/profile.test.ts
  - docs/decisions.md
conformance: []
modes: [local]
depends_on: [110]
status: claimed
claimed_by: claude-opus-t112
issue: 112
---

## What the user does
As one of several agents sharing a connection, I write under my own name.

## Done when
- [ ] `BOARD_TOKEN=… ob post dev hi --as fixer-2` shows `fixer-2 via laptop` in `ob read dev`
- [ ] `ob whoami --as fixer-2` prints actor `ob:conn:cn_…+fixer-2`

## Out of scope
- Avatars (113).
- Pinned profiles of claimed tokens (119).

## Notes
`docs/auth.md` "Upstream's model" points 2-3; profiles limited to the connection's `profiles` patterns.
