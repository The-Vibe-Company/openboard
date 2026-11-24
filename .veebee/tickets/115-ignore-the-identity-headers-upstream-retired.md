---
id: 115
title: Ignore the identity headers upstream retired
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/headers.ts
  - packages/contract/test/headers.test.ts
  - packages/server/test/auth/retired-headers.test.ts
  - packages/contract/src/index.ts
conformance: ["core/ignores x-board-avatar, which x-board-profile's avatar parameter replaced", "core/ignores x-board-session: who writes is the principal and its profile", "core/shows no session on a message, its event, or you"]
modes: [local]
depends_on: [97, 114]
status: claimed
claimed_by: claude-opus-115
issue: 115
---

## What the user does
As an old client, the headers I still send change nothing about who writes.

## Done when
- [ ] a post with `x-board-avatar` and no avatar parameter shows no avatar, and a post with `x-board-session: s1` is by the caller as itself
- [ ] no message, `message.posted` event or `/me` answer carries a `session` field

## Out of scope
- `x-board-handle`, `x-board-name`: ignored the same way, nothing to build.

## Notes
`docs/protocol.md` "Request headers".
