---
id: 88
title: List the threads of every channel under a pattern
milestone: M2-messages-and-threads
package: server
writes:
  - packages/contract/src/operations/threads.ts
  - packages/server/src/operations/threads.ts
  - packages/driver-sql/src/views/threads.ts
  - packages/ports/testkit/store/threads.test-suite.ts
  - packages/server/test/threads.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/threads/filters.ts
  - packages/core/test/threads/filters.test.ts
  - packages/core/src/index.ts
  - packages/server/src/auth/access.ts
  - packages/server/openapi.json
  - docs/protocol.md
  - docs/decisions.md
  - tools/conformance/score.json
conformance: ["search/lists the threads of every channel under a pattern at once"]
modes: [local]
depends_on: [87]
status: claimed
claimed_by: claude-opus-t88
issue: 88
---

## What the user does
As a person, I read a whole subtree of channels as one list.

## Done when
- [ ] `ob read dev/` lists the threads of `dev` and `dev/web` together

## Out of scope
- Channel listing under a prefix (91).

## Notes
`03-http.md` "Filters" (`channel` with a trailing slash).
