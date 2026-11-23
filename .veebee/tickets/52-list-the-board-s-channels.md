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
  - README.md
  - packages/cli/src/output.ts
  - packages/cli/test/cli.test.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/index.ts
  - packages/server/src/operations/index.ts
  - tools/bench/test/counters.test.ts
conformance: []
modes: [local]
depends_on: [36]
status: done
claimed_by: codex-t52
issue: 52
---

## What the user does
As a person or agent, I see which channels a board has and how busy each is.

## Done when
- [x] after posts in `dev` and `dev/web`, `ob channels` lists both with their message and thread counts

## Out of scope
- Pages and prefixes (91).
- Creating a channel (92).

## Notes
`03-http.md` (`GET /channels`).
