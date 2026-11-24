---
id: 201
title: Rate-limit claims per connection across instances
milestone: M7-hosted-deploy
package: driver-sql
writes:
  - packages/driver-sql/migrations/*-rate-counters.sql
  - packages/driver-sql/src/views/rates.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/rates.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/server/src/operations/connections.ts
  - packages/server/test/ha/claim-limit.test.ts
conformance: []
modes: [local, hosted]
depends_on: [199]
status: draft
claimed_by: null
issue: 362
---

## What the user does
As the operator of a shared instance, a connection that claims agent tokens in a loop is held to 30 claims a minute in total, whichever instances its claims reach.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/claim-limit.test.ts` passes: 30 claims of one connection alternating between two instances succeed, the 31st within the minute answers 429 `rate_limited` with a `retry-after` and spends nothing, another connection's claim passes, and claims pass again once the fake clock has moved a minute
- [ ] `bun test packages/driver-sqlite` and the Postgres testkit pass the new rates suite: a counter taken from two stores on one database at once never admits more than its limit in a window

## Out of scope
- Organization creation (203) and invitations (204), which reuse the counter this ticket lands.
- Token refreshes (202): a per-instance limit.

## Notes
- docs/auth.md "Rate limits" († claims per connection: 30/min, held across instances in Postgres) and docs/architecture.md "SaaS seams" (`rate_counters`). Land the shared counter once, for 203 and 204 too: a `rate_counters` table keyed by a scope and a key with a fixed window (migration, next free number), and a `takeRate(key, limit, windowMs, now)` method on the board, organization and platform views (`packages/ports/src/store.ts`, an append point), written once in `packages/driver-sql/src/views/rates.ts`. On Postgres one upsert counts and answers in one round trip; it runs before the claim's board-locked write, so a refused claim takes no board lock.
- Board and organization keys filter on `board_id`/`org_id`; the platform-level statements (per person, per IP) join the listed platform statements of the registry's tenant check (`packages/driver-sql/src/statements.ts`, docs/codebase.md 3.2). Old windows are swept by M15's sweep (395).
- The claim handler is `claimConnectionHandler` in `packages/server/src/operations/connections.ts`.
