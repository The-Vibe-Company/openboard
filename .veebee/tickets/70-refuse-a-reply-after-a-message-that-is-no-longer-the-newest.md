---
id: 70
title: Refuse a reply after a message that is no longer the newest
milestone: M2-messages-and-threads
package: core
writes:
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/messages/post.ts
  - packages/core/test/messages/post.test.ts
conformance: ["core/replies after a message only while it's the thread's newest, one of any that race"]
modes: [local]
depends_on: [69]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent, I reply only if nobody has answered since I last read.

## Done when
- [ ] with #2 the newest message of thread 1, `ob reply 1 a --after 2` posts; `ob reply 1 b --after 2` then prints `error: newer_message` with the command that reads what came after, exits 1, and posts nothing

## Out of scope
- Edits at a revision (73).

## Notes
`03-http.md` "Posting" (`after`); race-free under the board lock (D33).
