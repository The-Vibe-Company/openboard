---
id: 68
title: Post once for a client ID
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
conformance: ["core/posts once for a client ID, however many times it is sent"]
modes: [local]
depends_on: [67]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent that retries, my message lands once however many times I send it.

## Done when
- [ ] `ob post dev deploy --idempotency-key deploy-1` run twice prints the same ID, and `ob read dev` shows the message once

## Out of scope
- Task client IDs (M9, 241).

## Notes
`03-http.md` "Posting" (`id`).
