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
conformance: ["search/lists the threads of every channel under a pattern at once"]
modes: [local]
depends_on: [87]
status: draft
claimed_by: null
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
