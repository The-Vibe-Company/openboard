---
id: 322
title: Deliver each event exactly once across two instances
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/server/test/ha/webhooks.test.ts
  - packages/server/test/support/receiver.ts
conformance: []
modes: [hosted]
depends_on: [321]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the operator of a hosted board on two instances, each webhook delivery reaches the receiver once, in thread order, even though both instances poll the same outbox.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/webhooks.test.ts` passes: 200 events over 20 threads, written through both instances while both dispatchers run, reach a receiver that records every POST: each delivery ID arrives exactly once, each thread's events in log order
- [ ] in the same file, an instance stopped while holding a delivery's lease (after the receiver answered, before it was marked done) leaves the delivery to the other instance after the 30 s lease: the receiver sees that ID twice and the test asserts it dedupes on `webhook-id`, the at-least-once case docs/architecture.md names

## Out of scope
- Any new behaviour: this ticket proves 304-321 together and fixes what it finds in their files (named in the PR).

## Notes
docs/project.md M11 "Done when" (webhook delivery exactly once across two instances, HA test), docs/architecture.md "Jobs any instance can take" (webhook deliveries: at-least-once by nature, receivers dedupe by delivery ID), docs/codebase.md 6.4 (`packages/server/test/ha/`). The receiver in `test/support/receiver.ts` is an in-process `fetch` fake shared by both instances, so no network is needed; the lease and clock come from `deps`.
