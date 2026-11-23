---
id: 45
title: Reply in a thread
milestone: M1-walking-skeleton
package: server
writes:
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/messages/post.ts
  - packages/core/test/messages/post.test.ts
conformance: ["core/posts a message, and reads it back by its ID"]
modes: [local]
depends_on: [40, 43, 44]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person or agent, I answer a message in its thread.

## Done when
- [ ] `ob reply 1 "on it"` prints `2`, and `ob read 1` shows #2 under #1
- [ ] `ob read dev` lists #1 then #2

## Out of scope
- Replying to a reply (46).
- `--after` (70), client IDs (68).

## Notes
The kit's first post check also posts a reply and needs discovery and `GET /me` (hence the dependencies).
