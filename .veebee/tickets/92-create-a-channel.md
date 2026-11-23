---
id: 92
title: Create a channel
milestone: M2-messages-and-threads
package: server
writes:
  - packages/contract/src/operations/channels.ts
  - packages/server/src/operations/channels.ts
  - packages/driver-sql/src/views/channels.ts
  - packages/server/test/channels.test.ts
  - packages/core/src/channels/create.ts
  - packages/core/test/channels/create.test.ts
  - README.md
  - packages/cli/src/main.ts
  - packages/cli/src/output.ts
  - packages/cli/test/cli.test.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operation.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/index.ts
  - packages/core/src/messages/post.ts
  - packages/driver-sql/src/views/events.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/channels.test-suite.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/http/respond.ts
  - packages/server/src/operations/index.ts
  - tools/bench/test/counters.test.ts
  - packages/server/src/http/openapi.ts
  - packages/server/test/openapi.test.ts
  - packages/server/openapi.json
conformance: []
modes: [local]
depends_on: [91]
status: done
claimed_by: codex-t92
issue: 92
---

## What the user does
As a person, I create a channel before anyone posts in it.

## Done when
- [x] `ob channels create dev/alerts` reports it created, and `ob channels` lists it with no messages

## Out of scope
- Private channels and their grants (M10, 294).

## Notes
`channel.created` (`03-http.md` "Event types").
