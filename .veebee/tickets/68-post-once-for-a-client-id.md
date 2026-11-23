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
  - packages/contract/src/operation.ts
  - packages/cli/src/commands/derived.ts
  - packages/cli/test/cli.test.ts
  - packages/server/src/operations/events.ts
  - packages/server/openapi.json
conformance: ["core/posts once for a client ID, however many times it is sent"]
modes: [local]
depends_on: [53]
status: done
claimed_by: claude-opus-t68
issue: 68
---

## What the user does
As an agent that retries, my message lands once however many times I send it.

## Done when
- [x] `ob post dev deploy --idempotency-key deploy-1` run twice prints the same ID, and `ob read dev` shows the message once

## Out of scope
- Task client IDs (M9, 241).
- Reading your post back by its client ID, `GET /posts/:id` (67).

## Notes
`03-http.md` "Posting" (`id`).
