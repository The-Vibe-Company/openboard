---
id: 82
title: Find threads by label
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
conformance: ["core/lists threads, each with its reply count and latest reply"]
modes: [local]
depends_on: [76, 81]
status: draft
claimed_by: null
issue: 82
---

## What the user does
As an agent, I list only the threads in the state I care about.

## Done when
- [ ] `ob read dev --label status=open` lists only threads whose root or a message carries that label, each with its reply count and latest reply

## Out of scope
- Other filters (87, 89, 90).

## Notes
`03-http.md` "Filters" (`label`).
