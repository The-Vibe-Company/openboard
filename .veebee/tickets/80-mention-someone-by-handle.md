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
  - packages/ports/src/index.ts
  - packages/core/src/messages/post.ts
  - packages/core/src/messages/mentions.ts
  - packages/core/test/messages/mentions.test.ts
  - packages/contract/src/entities/messages.ts
  - packages/core/src/messages/edit.ts
  - packages/core/src/messages/delete.ts
  - packages/server/src/auth/access.ts
  - packages/server/src/operations/events.ts
  - packages/server/src/operations/threads.ts
  - packages/server/openapi.json
  - docs/protocol.md
  - README.md
  - packages/server/test/mentions.test.ts
  - tools/conformance/score.json
conformance: ["core/stores a handle one actor has as a mention of them, and keeps one no one has as typed"]
modes: [local]
depends_on: [53, 79]
status: done
claimed_by: codex
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
