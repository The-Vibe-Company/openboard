---
id: 404
title: Ignore an instance's own notifications for tails it already served
milestone: M6-high-availability
package: driver-postgres
writes:
  - packages/driver-postgres/src/broadcaster.ts
  - packages/driver-postgres/test/broadcaster.test.ts
  - packages/server/src/live/fan-out.ts
  - packages/server/test/live/fan-out.test.ts
conformance: []
modes: [hosted]
depends_on: [177]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an operator on Postgres, a post served to my instance's tails from memory costs no extra store read when that instance's own `NOTIFY` for the same commit arrives.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/live/fan-out.test.ts --rerun-each 20` passes every run, with the single-instance cases asserting zero store reads for tails served from memory
- [ ] a test in `packages/driver-postgres/test/broadcaster.test.ts` shows that a notification for a position a subscriber already reached (from the local publish) does not wake it again, while a notification from another instance for a newer position still does

## Out of scope
- Cross-instance in-memory delivery (notifications carry only the head, D36).

## Notes
Found while reviewing #627 and #630: on Postgres, `fan-out.test.ts` flaked on single-instance runs ("a slow tail never delays the others" expected 0 store reads, got 2; "a page served from memory…" expected 0, got 4). `pg_notify` in `setHead` reaches the writing instance too; if that late notification re-wakes tails already served from memory, each makes a needless store read. Check that the broadcaster compares against the position the in-memory fan-out delivered, not only the one the last publish recorded.
