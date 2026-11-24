---
id: 174
title: Count database round trips per write
milestone: M5-postgres-driver
package: tools
writes:
  - packages/driver-postgres/src/counters.ts
  - packages/driver-postgres/src/pool.ts
  - packages/driver-postgres/test/counters.test.ts
  - tools/bench/src/**
  - tools/bench/budgets.json
  - tools/bench/test/**
conformance: []
modes: [hosted]
depends_on: [173]
status: done
claimed_by: codex
issue: 254
---

## What the user does
As a contributor, an extra database round trip in a hosted write fails the bench before it ships.

## Done when
- [x] `OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun run bench --quick --mode hosted` prints round trips per operation next to statements, and `tools/bench/budgets.json` holds them under `hosted.counters`
- [x] on a scratch branch, one more awaited statement in the post path (`packages/driver-sql/src/views/messages.ts`) makes the same command exit 1 naming `post` and both counts

## Out of scope
- Lowering the count by pipelining a write's statements: no ticket in the cut yet (see the PR that wrote this ticket).
- Measured latencies (173).

## Notes
- docs/codebase.md 6.6 ("database round trips per operation (Postgres)", exact counters, any increase fails) and docs/architecture.md "Hosted mode (Postgres)" cost model. A round trip is one wait on the server: statements sent together in one pipeline (awaited with `Promise.all` inside `sql.begin`, D32) count once; `BEGIN` and `COMMIT` count one each.
- Today the shared views await each fold statement in turn (`foldMessagePosted` in `packages/driver-sql/src/views/messages.ts`), so a post is expected to cost more than D41's four round trips. Record what is measured; do not change the views here.
- The counter sits where the driver sends statements (`pool.ts`), exported through `counters.ts` as the statement counter is (173).
