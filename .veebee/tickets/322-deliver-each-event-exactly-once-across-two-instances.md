---
id: 322
title: Deliver each event exactly once across two instances
milestone: M11-webhooks-and-watchers
package: server
writes:
  - .github/workflows/nightly.yml
  - packages/server/test/support/env.ts
  - packages/server/test/ha/webhooks.test.ts
  - packages/server/test/support/receiver.ts
conformance: []
modes: [hosted]
depends_on: [321]
status: done
claimed_by: codex
issue: 507
---

## What the user does
As the operator of a hosted board on two instances, each webhook delivery reaches the receiver once, in thread order, even though both instances poll the same outbox.

## Done when
- [x] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/webhooks.test.ts` passes: 12 events over 4 threads, written through both instances during concurrent dispatch, reach a receiver that records every POST. Each delivery ID arrives exactly once and each thread's events arrive in log order. The test takes less than one second.
- [x] The same command passes the lease takeover test: the first instance stops after the receiver answers and before completion. The second instance sends again at the 30 s lease expiry. The receiver sees the same `webhook-id` twice and applies its effect once.
- [x] The nightly full-bench job runs the same ordering and uniqueness assertions over 200 events and 20 threads with `OPENBOARD_TEST_WEBHOOK_STRESS=1` in addition to the Postgres test environment above.

## Out of scope
- Any new behaviour: this ticket proves 304-321 together and fixes what it finds in their files (named in the PR).

## Notes
docs/project.md M11 "Done when" (webhook delivery exactly once across two instances, HA test), docs/architecture.md "Jobs any instance can take" (webhook deliveries: at-least-once by nature, receivers dedupe by delivery ID), docs/codebase.md 6.4 (`packages/server/test/ha/`). The receiver in `test/support/receiver.ts` is an in-process `fetch` fake shared by both instances, so no network is needed; the lease and clock come from `deps`.
