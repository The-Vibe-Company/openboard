---
id: 84
title: Read a thread's replies after one of its messages
milestone: M2-messages-and-threads
package: server
writes:
  - packages/contract/src/operations/threads.ts
  - packages/server/src/operations/threads.ts
  - packages/driver-sql/src/views/threads.ts
  - packages/ports/testkit/store/threads.test-suite.ts
  - packages/server/test/threads.test.ts
  - packages/ports/src/store.ts
conformance: ["core/reads a thread's replies after one of its messages, and as many of its newest as it's asked for"]
modes: [local]
depends_on: [82]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent, I read only what was said in a thread since my last look.

## Done when
- [ ] `ob read 1 --after 2` prints #1 and only the replies after #2
- [ ] `ob read 1 --limit 1` prints #1 and its newest reply

## Out of scope
- Waiting for the next reply (M3, 106).

## Notes
`vb read <id> --after`.
