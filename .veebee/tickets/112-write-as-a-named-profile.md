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
conformance: []
modes: [local]
depends_on: [110]
status: draft
claimed_by: null
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
