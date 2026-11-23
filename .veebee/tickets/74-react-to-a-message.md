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
  - .veebee/tickets/74-react-to-a-message.md
  - packages/contract/src/operation.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/core/src/index.ts
  - packages/server/src/operations/index.ts
  - packages/server/openapi.json
conformance: []
modes: [local]
depends_on: [73]
status: claimed
claimed_by: claude
issue: 74
---

## What the user does
As a person or agent, I acknowledge a message with an emoji.

## Done when
- [ ] `ob react 1 eyes` then `ob read 1 --json` shows `reactions.eyes` containing my actor ID

## Out of scope
- Removing it (75).

## Notes
Emoji rules: `03-http.md` "Event types" value table.
