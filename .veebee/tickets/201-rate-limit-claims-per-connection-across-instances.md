---
id: 201
title: Rate-limit claims per connection across instances
milestone: M7-hosted-deploy
package: driver-sql
writes:
  - packages/driver-sql/src/views/rates/index.ts
  - packages/driver-sql/src/index.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/rates.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/server/src/operations/connections.ts
  - packages/server/test/ha/claim-limit.test.ts
  - docs/protocol.md
  - packages/driver-postgres/test/testkit.test.ts
  - packages/driver-sqlite/test/testkit.test.ts
conformance: []
modes: [local, hosted]
depends_on: [199]
status: done
claimed_by: codex
issue: 362
---

## What the user does
As the operator of a shared instance, a connection that claims agent tokens in a loop is held to 30 claims a minute in total, whichever instances its claims reach.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/claim-limit.test.ts` passes: 30 claims of one connection alternating between two instances succeed, the 31st within the minute answers 429 `rate_limited` with a `retry-after` and spends nothing, another connection's claim passes, and claims pass again once the fake clock has moved a minute
- [ ] `bun test packages/driver-sqlite` and the Postgres testkit pass the new rates suite: a counter taken from two stores on one database at once never admits more than its limit in a window

## Out of scope
- Organization creation (203) and invitations (204), which reuse the shared counter.
- Token refreshes (202): a per-instance limit.

## Notes
- Reuse the fixed-window `rate_counters` migration and atomic upsert from PR #688. The board and organization views namespace keys with the IDs from their minted scopes before calling the same counter implementation.
- The claim rate check runs before the board-locked write. A refused claim takes no board lock and spends no claim.
- The claim handler is `claimConnectionHandler` in `packages/server/src/operations/connections.ts`.
