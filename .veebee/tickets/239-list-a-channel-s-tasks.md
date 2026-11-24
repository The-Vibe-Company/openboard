---
id: 239
title: List a channel's tasks
milestone: M9-tasks
package: server
writes:
  - .veebee/tickets/239-list-a-channel-s-tasks.md
  - docs/protocol.md
  - packages/contract/src/operations/tasks/list.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/core/src/tasks/filters.ts
  - packages/core/src/index.ts
  - packages/core/test/tasks/filters.test.ts
  - packages/ports/src/tasks.ts
  - packages/ports/src/index.ts
  - packages/ports/testkit/index.ts
  - packages/ports/testkit/store/tasks.test-suite.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/views/tasks/list.ts
  - packages/driver-sql/src/views/tasks/tasks.ts
  - packages/driver-sql/src/views/threads.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/openapi.json
  - packages/server/src/operations/tasks.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/tasks/list.test.ts
  - packages/cli/src/output.ts
  - packages/cli/test/tasks.test.ts
  - skills/openboard/references/commands.md
conformance: []
modes: [local, hosted]
depends_on: [238]
status: done
claimed_by: claude-opus
issue: 412
---

## What the user does
As an agent, I see what work is open in a channel with `ob tasks dev`, oldest first, each task with its latest reply.

## Done when
- [ ] after `ob tasks create dev "a"`, `ob tasks create dev "b"` and `ob reply 2 "started"`, `ob tasks dev` prints one row per open task, oldest first (ID, state, first line, labels), and `ob tasks dev --json` shows `{ tasks, cursor }` with each task `{ message, replies, last }`, `2`'s `replies` `1` and `last` that reply
- [ ] `ob tasks dev --limit 1` prints one row and then the command that reads the next page (`ob tasks dev --limit 1 --after <cursor>`); `ob tasks dev/` lists `dev` and every channel under it; `ob tasks --state all` lists the whole board's tasks in every state; `ob tasks dev --label k=v` only those with that label

## Out of scope
- `needs=` (255) and `latest` (256).
- States other than `ready` arrive with the tickets that make them (242 onward).
- The tasks list in the front (273).

## Notes
- Upstream `GET /tasks`: query `channel`, `state` (open by default: `waiting`, `ready`, `claimed`, `blocked`; `all` or one state), `label`, `by`, `owner`, `for`, `after`, `limit`; `owner` and `for` take a handle or an ID; each task a thread summary. `TasksQuery` and `TasksPage` in `@vercel/board`.
- Summaries as `GET /threads` builds them (`listThreads` in `driver-sql/src/views/threads.ts`), with core's `threads/filters.ts` for labels and subtrees; a subtree needs read throughout it (D53, `allowedThroughout` in `server/src/auth/access.ts`). Indexes `tasks_ready`, `tasks_owner`, `tasks_for` (docs/data-model.md).
