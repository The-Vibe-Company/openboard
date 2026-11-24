---
id: 266
title: Claim the next ready task with a label
milestone: M9-tasks
package: server
writes:
  - docs/protocol.md
  - packages/cli/src/commands/derived.ts
  - packages/cli/test/tasks.test.ts
  - packages/contract/src/operations/tasks/queue.ts
  - packages/contract/src/operations/thread-filters.ts
  - packages/core/src/threads/filters.ts
  - packages/driver-sql/src/views/tasks/list.ts
  - packages/driver-sql/src/views/tasks/tasks.ts
  - packages/ports/src/tasks.ts
  - packages/server/openapi.json
  - packages/server/src/operations/tasks/queue.ts
  - packages/server/test/tasks/claim-next-label.test.ts
  - skills/openboard/references/commands.md
conformance: []
modes: [local, hosted]
depends_on: [265]
status: done
claimed_by: codex
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
