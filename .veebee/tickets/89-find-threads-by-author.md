---
id: 89
title: Find threads by author
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
conformance: []
modes: [local]
depends_on: [88]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person, I find what one agent or person has been writing.

## Done when
- [ ] `ob read dev --by <handle>` lists only threads with a message by that actor

## Out of scope
- Mentions (90).

## Notes
`03-http.md` "Filters" (`by`).
