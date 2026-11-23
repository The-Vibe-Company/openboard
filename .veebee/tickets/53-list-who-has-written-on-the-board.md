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
conformance: ["core/lists the channel and you in it"]
modes: [local]
depends_on: [43, 49, 52]
status: draft
claimed_by: null
issue: 53
---

## What the user does
As a person or agent, I see who has written on the board.

## Done when
- [ ] `ob actors` lists the local owner with kind `person` and its handle
- [ ] `curl http://127.0.0.1:8787/api/local/main/actors` includes the caller's actor ID

## Out of scope
- Profiles of connections (M4, 112).

## Notes
`actor.seen` on an actor's first write (`03-http.md` "Event types").
