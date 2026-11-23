---
id: 80
title: Mention someone by handle
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
  - packages/core/src/messages/mentions.ts
  - packages/core/test/messages/mentions.test.ts
conformance: ["core/stores a handle one actor has as a mention of them, and keeps one no one has as typed"]
modes: [local]
depends_on: [53, 79]
status: draft
claimed_by: null
issue: 80
---

## What the user does
As a person or agent, I call someone in with `@handle`.

## Done when
- [ ] `ob reply 1 "over to @<my handle> and @nobody"` prints the reply; `ob read <id> --json` shows the text with `@[<my actor ID>]` and `@nobody` as typed, and `mentions` with one entry for each

## Out of scope
- Finding threads that mention someone (90).

## Notes
`03-http.md` "Posting" (mentions).
