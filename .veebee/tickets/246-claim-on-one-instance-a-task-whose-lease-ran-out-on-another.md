---
id: 246
title: Claim on one instance a task whose lease ran out on another
milestone: M9-tasks
package: server
writes:
  - packages/server/test/ha/tasks.test.ts
conformance: []
modes: [local, hosted]
depends_on: [177, 245]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the owner of a hosted board, a task claimed through one instance and left to expire is claimable through the other, exactly once.

## Done when
- [ ] with the test Postgres up (`docker compose -f docker-compose.test.yml up -d --wait`), `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/tasks.test.ts` passes: a lease taken on instance 1 and expired by the shared fake clock is claimed on instance 2 with `epoch` 2; both instances' job runners polling at once append one `task.expired`; the first claim's complete through either instance answers 409 `claim_lost`

## Out of scope
- The generic HA cases (177-184).

## Notes
docs/codebase.md 6.4 ("a lease taken on 1 and expired is claimable on 2"), with 177's two-instance harness (`packages/server/test/support/`). A failure here is a single-process assumption in 242-245 (AGENTS.md non-negotiable 8): fix it there, never pin the test to one instance.
