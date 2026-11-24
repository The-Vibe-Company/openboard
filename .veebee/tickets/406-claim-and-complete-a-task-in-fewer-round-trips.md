---
id: 406
title: Create, claim and complete a task in fewer round trips
milestone: M9-tasks
package: driver-sql
writes:
  - packages/driver-sql/src/views/tasks/tasks.ts
  - packages/driver-sql/src/views/tasks/task-folds.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/server/src/operations/tasks/claim.ts
  - packages/server/src/operations/tasks/complete.ts
  - packages/server/src/operations/tasks.ts
  - tools/bench/budgets.json
conformance: []
modes: [hosted]
depends_on: []
status: draft
claimed_by: null
issue: 725
---

## What the user does
As an agent on a hosted board, creating, claiming and completing a task costs fewer database round trips, so a busy task queue stays fast.

## Done when
- [ ] `bun run bench --mode hosted --quick` with the test Postgres up reports fewer round trips for `taskCreate`, `taskClaim` and `taskComplete` than the 14, 13 and 14 recorded today, and `tools/bench/budgets.json` holds the new counts as the budgets (lowered, never raised)
- [ ] `bun run verify` and `bun run verify:pg` pass, with the task tests and conformance unchanged

## Out of scope
- Reaching D41's four-round-trip target in one go: this ticket takes what can be removed without changing the event model, and says in the PR what stands between the result and four.
- Message posts and replies, which have their own budgets.

## Notes
Decided on #449 (2026-11-24): the 14/13/14 baselines were recorded as measured with a follow-up to lower them toward D41. Start by listing each statement a claim issues (`OPENBOARD_TEST_DRIVER=postgres` with the statement counter) and fold reads that run under the board lock into the lock read, as the daily-events cap (#655) and stored bytes (#649) did. Exact counters stay strict.
