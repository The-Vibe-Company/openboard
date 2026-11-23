---
id: 74
title: React to a message
milestone: M2-messages-and-threads
package: core
writes:
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/messages/reactions.ts
  - packages/core/test/messages/reactions.test.ts
conformance: []
modes: [local]
depends_on: [73]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person or agent, I acknowledge a message with an emoji.

## Done when
- [ ] `ob react 1 eyes` then `ob read 1 --json` shows `reactions.eyes` containing my actor ID

## Out of scope
- Removing it (75).

## Notes
Emoji rules: `03-http.md` "Event types" value table.
