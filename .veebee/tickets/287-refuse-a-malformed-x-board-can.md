---
id: 287
title: Refuse a malformed x-board-can
milestone: M10-access
package: server
writes:
  - packages/core/src/access/narrow.ts
  - packages/core/test/access/narrow.test.ts
  - packages/server/src/auth/access.ts
  - docs/protocol.md
  - packages/server/test/auth/narrowing-invalid.test.ts
conformance: []
modes: [local, hosted]
depends_on: [286]
status: done
claimed_by: codex
issue: 462
---

## What the user does
As an agent author, a typo in my `x-board-can` is refused with what to write, never read as something else.

## Done when
- [x] `curl -s -H @agent.headers -H 'x-board-can: dev' "$BOARD_URL/me"` answers 400 `invalid_scope` whose message says what to write (`pattern=permissions;…`), and so do a header over 4000 characters, an unknown permission and upstream's old `x-board-scope` header; `bun test packages/server/test/auth/narrowing-invalid.test.ts` covers each

## Out of scope
- Narrowing itself (286).

## Notes
Upstream `03-http.md` "Errors": `invalid_scope` ("an `x-board-can` header the board can't parse, or one longer than 4000 characters, or the old `x-board-scope` header; the message says what to write") and `InvalidCan`'s messages.
