---
id: 240
title: Make a task of a thread that was there
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/tasks.ts
  - packages/core/src/tasks/create.ts
  - packages/core/test/tasks/create.test.ts
  - packages/ports/src/tasks.ts
  - packages/driver-sql/src/views/tasks.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/test/tasks/adopt.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
conformance: []
modes: [local, hosted]
depends_on: [239]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person triaging, I turn a thread someone already posted into a task with `ob tasks create 2`, without posting it again.

## Done when
- [ ] after `ob post dev "flaky test in ci"` (ID `2`), `ob tasks create 2` prints `2`; `ob read 2 --json` shows its `task` `ready`, with `by` the actor that made it a task (not the root's author), the root's text unchanged and `board.task` `ready`; `ob tasks dev` lists it
- [ ] `ob tasks create 2` again prints `error: already_a_task: …` and exits 1; with a direct connection whose grant is `dev=read,post` as `BOARD_TOKEN`, `ob tasks create 2` prints `error: forbidden: …` and the thread stays as it was

## Out of scope
- Client IDs (241); `needs` on a thread made a task (252, 253).
- Claiming a thread that is no task, 404 `not_a_task` (242).

## Notes
- Upstream "With `re` it makes a task of a thread as it is, and needs `label` in its channel"; `task.created` for an existing root, which posts nothing.
- Upstream's check `starts a thread as a task, or makes one of a thread that was there` also claims a plain thread and expects 404 `not_a_task`, which needs 242's claim route: 242 records it (`.veebee/cut.md` moved the `[c]`).
