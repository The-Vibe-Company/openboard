---
id: 272
title: Hold a task when someone else edits its root
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/messages.ts
  - docs/protocol.md
  - skills/openboard/SKILL.md
  - packages/core/src/index.ts
  - packages/core/src/tasks/ownership.ts
  - packages/core/src/messages/edit.ts
  - packages/core/test/messages/edit.test.ts
  - packages/server/src/operations/messages.ts
  - packages/server/test/tasks/root-edit.test.ts
conformance: []
modes: [local, hosted]
depends_on: [262, 271]
status: done
claimed_by: codex
issue: 447
---

## What the user does
As a task's owner, when someone else rewrites the task's root, the task is held for me to look at instead of being worked on as changed.

## Done when
- [x] for a thread posted `--as fixer` that the local owner made a task (`ob tasks create 2`) and claimed, `ob edit 2 "new text" --as fixer` holds it: `ob read 2 --json` shows `state: "blocked"` and `blocked.kind` `edited`, and the claim's `ob tasks complete 2` prints `error: claim_lost: …`; an edit by the task's owner holds nothing
- [x] `ob tasks unblock 2` as the owner makes it `ready` again

## Out of scope
- Upstream's check of this rule imports through sync: M14 (`holds a task when anyone but its owner edits its root…`).
- The profile case inside upstream's narrowed-profile check (292).

## Notes
Upstream "Editing it as anyone but the task's owner blocks the task, with kind `edited`, which ends any claim"; the owner is the actor in `by`, or its principal as itself (who edits what). Hold with 262's exported rule. Depends on 271 too: both change `server/src/operations/messages.ts`.
