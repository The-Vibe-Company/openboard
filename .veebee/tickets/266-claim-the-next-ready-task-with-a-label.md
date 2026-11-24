---
id: 266
title: Claim the next ready task with a label
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-queue.ts
  - packages/core/src/tasks/next.ts
  - packages/core/test/tasks/next.test.ts
  - packages/ports/src/tasks.ts
  - packages/driver-sql/src/views/tasks.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/test/tasks/claim-next-label.test.ts
  - packages/cli/test/tasks.test.ts
conformance: []
modes: [local, hosted]
depends_on: [265]
status: draft
claimed_by: null
issue: 440
---

## What the user does
As an agent with one skill, I take only the next task labelled for it, `ob tasks claim --next --channel dev --label step=review`.

## Done when
- [ ] with ready tasks 2 (`step=fix`) and 3 (`step=review`) in `dev`, `ob tasks claim --next --channel dev --label step=review` claims 3, and `--label step=deploy` claims none; label filters combine as `GET /threads`'s do (`k` for presence, `k=a|b` for either, repeated for all)

## Out of scope
- Waiting for one (267).

## Notes
Upstream `label: { step: "fix" }` on `POST /tasks/claim`; reuse core's `threads/filters.ts` label matching.
