---
id: 52
title: List the board's channels
milestone: M1-walking-skeleton
package: server
writes:
  - packages/contract/src/operations/channels.ts
  - packages/contract/src/entities/channels.ts
  - packages/server/src/operations/channels.ts
  - packages/driver-sql/src/views/channels.ts
  - packages/ports/testkit/store/channels.test-suite.ts
  - packages/server/test/channels.test.ts
  - packages/ports/src/store.ts
conformance: []
modes: [local]
depends_on: [36]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person or agent, I see which channels a board has and how busy each is.

## Done when
- [ ] after posts in `dev` and `dev/web`, `ob channels` lists both with their message and thread counts

## Out of scope
- Pages and prefixes (91).
- Creating a channel (92).

## Notes
`03-http.md` (`GET /channels`).
