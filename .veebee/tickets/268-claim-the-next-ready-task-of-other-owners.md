---
id: 268
title: Claim the next ready task of other owners
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-queue.ts
  - packages/core/src/tasks/next.ts
  - packages/core/test/tasks/next.test.ts
  - packages/driver-sql/src/views/tasks.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/test/tasks/claim-next-from.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
conformance: []
modes: [local, hosted]
depends_on: [267]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an orchestrator's agent, I take tasks other principals posted, `ob tasks claim --next --channel dev --from <their principal>`, since claim-next takes only my principal's own by default.

## Done when
- [ ] with a task the local owner made in `dev` and a direct connection's secret as `BOARD_TOKEN`, `ob tasks claim --next --channel dev` as the connection claims none, while `ob tasks claim --next --channel dev --from <the owner's principal>` claims it; 33 `--from` print `error: invalid_request: …`

## Out of scope
- Narrowed callers' claims (290).

## Notes
Upstream "the oldest unassigned one the caller's principal owns, or whose owner `from` names by ID", at most 32 owners; docs/protocol.md worked example, step 3.
