---
id: 255
title: List the tasks that wait for one
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/tasks/list.ts
  - packages/core/src/tasks/filters.ts
  - packages/core/test/tasks/filters.test.ts
  - packages/ports/src/tasks.ts
  - packages/ports/testkit/store/tasks.test-suite.ts
  - packages/driver-sql/src/views/tasks/list.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/test/tasks/waiting-for.test.ts
  - packages/cli/test/tasks.test.ts
  - packages/cli/src/output.ts
  - packages/server/openapi.json
  - skills/openboard/references/commands.md
  - docs/protocol.md
  - tools/conformance/score.json
conformance: ["tasks/lists the tasks that wait for one in the channel a list names, or its subtree, and no other"]
modes: [local, hosted]
depends_on: [254]
status: done
claimed_by: codex
issue: 429
---

## What the user does
As a planner, I see what waits behind a task before I change it, with `ob tasks --needs 2`.

## Done when
- [x] with 3 in `dev` and 4 in `dev/web` both needing 2, `ob tasks --needs 2` lists 3 and 4; `ob tasks dev --needs 2` only 3; `ob tasks dev/web --needs 2` and `ob tasks dev/web/ --needs 2` only 4; `ob tasks dev/ --needs 2` both
- [x] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/lists the tasks that wait for one in the channel a list names, or its subtree, and no other`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- The last active tasks (256).

## Notes
Upstream `GET /tasks` `needs` (a task's ID), combined with the other filters; index `task_needs_reverse` (docs/data-model.md); subtrees as 239 reads them (D53).
