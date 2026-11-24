---
id: 271
title: Cancel a task when its root is deleted
milestone: M9-tasks
package: server
writes:
  - packages/core/src/messages/delete.ts
  - packages/core/test/messages/delete.test.ts
  - packages/server/src/operations/messages.ts
  - packages/server/test/tasks/root-delete.test.ts
conformance: []
modes: [local, hosted]
depends_on: [250]
status: draft
claimed_by: null
issue: 445
---

## What the user does
As someone tidying a channel, deleting a task's root calls the task off in the same write, so no agent claims a task that is gone.

## Done when
- [ ] `ob delete 2` on a ready, claimed, held or failed task cancels it in the same write: the feed shows `message.deleted` then `task.canceled` with reason `deleted`, and `ob tasks dev --state canceled` lists it; deleting a completed task's root leaves it completed

## Out of scope
- Holding a task when someone else edits its root (272).

## Notes
- Upstream "Deleting a task's root cancels the task in the same write, with reason `deleted`, unless it completed". Upstream's kit deletes its tasks' roots at the end of a run, so this keeps a conformance board tidy.
- Reuse `core/tasks/cancel.ts` (250) and `BoardWriter`'s task read without editing them, so this runs beside 251-269.
