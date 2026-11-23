---
id: 182
title: Drop a revoked credential on every instance at once
milestone: M6-high-availability
package: server
writes:
  - packages/server/src/auth/**
  - packages/server/test/ha/revoke.test.ts
conformance: []
modes: [local, hosted]
depends_on: [177]
status: draft
claimed_by: null
issue: 262
---

## What the user does
As a board admin, a connection, agent token or session I revoke stops working on every instance with the very next request.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/revoke.test.ts` passes: a connection secret, a claimed agent token and a session, each used once on both instances, are revoked through instance 1, and their next request on instance 2 answers 401 `unauthorized`
- [ ] in the same file, removing a member through instance 1 makes their next request on instance 2 answer 404, within the same test (no 60 s wait)

## Out of scope
- Revoking itself, built in M4 (128, 129, 140, 141, 151).
- Rate limits per credential across instances (M7, 199-202).

## Notes
- docs/codebase.md 5.6: caches are allowed only if correct when stale or invalidated through the `Broadcaster`; docs/auth.md "Sessions and CSRF" caches membership checks 60 s, "invalidated on membership change"; docs/architecture.md "Life of a write" step 2 looks up a token hash "LRU, then store". If the chain (`packages/server/src/auth/chain.ts` and its verifiers) caches nothing when this ticket starts, the test is the guard that keeps a future cache honest; if it caches, invalidate from the revoke and membership events every instance reads through the `Broadcaster`.
- No timers in server code: invalidation follows events, not a clock.
