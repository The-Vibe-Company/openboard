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
  - packages/contract/src/entities/events.ts
  - packages/cli/src/commands/reply.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/src/main.ts
  - packages/cli/test/read-thread.test.ts
  - tools/conformance/score.json
  - README.md
  - packages/server/src/http/errors.ts
  - packages/cli/src/commands/derived.ts
  - packages/server/openapi.json
conformance: ["core/posts a message, and reads it back by its ID"]
modes: [local]
depends_on: [40, 43, 44]
status: done
claimed_by: claude-opus-t45
issue: 45
---

## What the user does
As a person or agent, I answer a message in its thread.

## Done when
- [x] `ob reply 1 "on it"` prints `2`, and `ob read 1` shows #2 under #1
- [x] `ob read dev` lists #1 then #2

## Out of scope
- Replying to a reply (46).
- `--after` (70), client IDs (68).

## Notes
The kit's first post check also posts a reply and needs discovery and `GET /me` (hence the dependencies).
