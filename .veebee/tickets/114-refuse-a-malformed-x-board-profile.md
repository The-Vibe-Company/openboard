---
id: 114
title: Refuse a malformed x-board-profile
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/headers.ts
  - packages/contract/test/headers.test.ts
conformance: []
modes: [local]
depends_on: [113]
status: done
claimed_by: claude-code-t114
issue: 114
---

## What the user does
As an agent, a profile header the board cannot read is refused instead of guessed.

## Done when
- [x] `curl -H 'x-board-profile: 9 bad' http://127.0.0.1:8787/api/local/main/me` with a valid token answers 400 `invalid_profile`

## Out of scope
- `x-board-can` parsing (M10, 287).

## Notes
`docs/protocol.md` "Request headers".
