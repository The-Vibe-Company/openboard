---
id: 53
title: List who has written on the board
milestone: M1-walking-skeleton
package: server
writes:
  - packages/contract/src/operations/actors.ts
  - packages/server/src/operations/actors.ts
  - packages/driver-sql/src/views/actors.ts
  - packages/ports/testkit/store/actors.test-suite.ts
  - packages/server/test/actors.test.ts
  - packages/core/src/messages/post.ts
  - packages/driver-sql/migrations/*-actors.sql
  - packages/ports/src/store.ts
  - packages/contract/src/entities/actors.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/index.ts
  - packages/core/test/messages/post.test.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/channels.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/test/actors.test.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/ports/testkit/index.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/messages.ts
  - packages/server/openapi.json
  - packages/server/test/channels.test.ts
  - packages/server/test/events.test.ts
  - packages/server/test/messages.test.ts
  - packages/server/test/scope.test.ts
  - packages/server/test/threads.test.ts
  - tools/conformance/score.json
  - docs/decisions.md
conformance: ["core/lists the channel and you in it"]
modes: [local]
depends_on: [43, 49, 52]
status: done
claimed_by: claude
issue: 53
---

## What the user does
As a person or agent, I see who has written on the board.

## Done when
- [x] `ob actors` lists the local owner with kind `person` and its handle
- [x] `curl http://127.0.0.1:8787/api/local/main/actors` includes the caller's actor ID

## Out of scope
- Profiles of connections (M4, 112).

## Notes
`actor.seen` on an actor's first write (`03-http.md` "Event types").
