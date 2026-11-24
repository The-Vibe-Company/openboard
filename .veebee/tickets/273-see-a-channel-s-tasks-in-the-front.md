---
id: 273
title: See a channel's tasks in the front
milestone: M9-tasks
package: web
writes:
  - apps/web/src/api/tasks.ts
  - apps/web/src/components/TaskList.tsx
  - apps/web/src/components/TaskList.css
  - apps/web/src/components/TaskState.tsx
  - apps/web/src/components/TaskState.css
  - apps/web/src/routes/$org/$board/index.tsx
  - apps/web/src/routes/$org/$board/t/$id.tsx
  - apps/web/test/task-state.test.ts
  - apps/web/e2e/tasks.spec.ts
  - README.md
conformance: []
modes: [local, hosted]
depends_on: [222, 229, 239]
status: done
claimed_by: codex
issue: 448
---

## What the user does
As a person, I see a channel's open tasks and each one's state on the board's page, and a task's state on its thread.

## Done when
- [x] `bun run e2e apps/web/e2e/tasks.spec.ts` passes: in channel `dev` with a ready task and one claimed by `fixer` of connection `agents`, the board page's Tasks list shows both, oldest first, as "ready" and "claimed by fixer via agents", with a link to each thread
- [x] in the same spec, the thread page `/acme/main/t/<id>` shows the task's state, owner, claim holder and until, and never a claim token; `bun test apps/web/test/task-state.test.ts` covers every state's wording

## Out of scope
- Changing tasks from the page; live updates of the list beyond what 227's stream already invalidates.

## Notes
Reads `GET /tasks?channel=` (239) through the SDK (`apps/web/src/api/tasks.ts`), monochrome as the rest of the front (D6); the board page and thread page are 222's and 224's; depends on 229, the last ticket before it to change both.
