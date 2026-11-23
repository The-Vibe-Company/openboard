---
id: 179
title: Catch up by cursor after the database restarts
milestone: M6-high-availability
package: driver-postgres
writes:
  - packages/driver-postgres/src/broadcaster.ts
  - packages/driver-postgres/test/reconnect.test.ts
conformance: []
modes: [hosted]
depends_on: [176, 178]
status: draft
claimed_by: null
issue: 259
---

## What the user does
As an agent following a board, after the database restarts I receive every post made since, once each and in order, without reconnecting myself.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres/test/reconnect.test.ts` passes: with every backend of the database terminated, instance 1's listener re-subscribes with backoff, its subscriber reads once from its cursor, and receives the writes made through instance 2 while it was down, each once, in order

## Out of scope
- Requests answering 503 while the database is down (172) and the drill across both instances over HTTP (180).
- The timeline guard for a failover that loses commits (185).

## Notes
- docs/architecture.md "Live fan-out across instances" (notifications sent while the listener is disconnected are lost; "on every reconnect each tail re-reads from its cursor") and "Upgrade path to a failover database" (reconnect with jittered backoff, DNS re-resolved, re-subscribe and catch up). Bun's `sql.listen` re-subscribed after a Postgres restart without application code (D36, measured): the driver still has to notice the reconnect to trigger the re-read.
- Backoff delays come from the driver's injected timer (178), so the test advances them.
- Depends on 178 because both change `packages/driver-postgres/src/broadcaster.ts`; reuses its connection-termination helper in `packages/driver-postgres/src/database.ts`.
