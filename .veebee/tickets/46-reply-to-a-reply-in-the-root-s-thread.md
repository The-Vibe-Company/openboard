---
id: 46
title: Reply to a reply in the root's thread
milestone: M1-walking-skeleton
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
conformance: ["core/puts a reply in its root's thread"]
modes: [local]
depends_on: [45]
status: draft
claimed_by: null
issue: 46
---

## What the user does
As a person or agent, I answer a reply and my message joins the root's thread.

## Done when
- [ ] `ob reply 2 "deeper"` prints `3`, and `ob read 1 --json` shows #3 with `re` `"1"` and `replyTo` `"2"`

## Out of scope
- Thread reads after a message (84).

## Notes
`03-http.md` "Posting" (`re` is any message in the thread).
