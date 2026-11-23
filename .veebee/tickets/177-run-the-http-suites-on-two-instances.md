---
id: 177
title: Run the HTTP suites on two instances
milestone: M6-high-availability
package: server
writes:
  - packages/server/test/**
  - packages/server/src/live/**
conformance: []
modes: [local, hosted]
depends_on: [176]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the owner of the code base, every HTTP and isolation behaviour holds when consecutive requests land on different instances.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun run --filter @openboard/server test` passes with every `makeApp()` a cluster of two apps on one fresh database whose `fetch` alternates between them, the long-poll and SSE tests and `packages/server/test/isolation` included
- [ ] `bun test packages/server/test/support/cluster.test.ts` (with the same variables) shows request 1 served by instance 1 and request 2 by instance 2, and `bun test packages/server` without them still runs one SQLite app

## Out of scope
- The cases alternation cannot reach, under `packages/server/test/ha/` (180-184).
- Conformance on two instances (186).

## Notes
- docs/codebase.md 6.1 (`makeApp()` with `OPENBOARD_TEST_DRIVER=postgres` is "a two-instance cluster on a fresh Postgres database whose `fetch` alternates requests between the instances") and 6.4. Each instance is its own `createApp` with its own driver (own pool and listener) on the shared database, as two processes would be; they share only the test's fake clock, ID sequence and random bytes, so tests that read `req-1` or fixed tokens still hold.
- A test that only passes when both requests reach one instance is a single-process assumption (AGENTS.md non-negotiable 8): fix the code it exposes, never pin the test to one instance. Label `isolation`: the isolation suite runs on the cluster from here.
- Swapped with 176 in `.veebee/cut.md` (see 176).
