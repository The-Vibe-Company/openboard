---
id: 290
title: Refuse a claim by a caller without label
milestone: M10-access
package: server
writes:
  - packages/server/test/tasks/narrowed-claim.test.ts
  - tools/conformance/score.json
conformance: ["tasks/takes label in its channel to claim a task: a caller narrowed to reading and posting claims none"]
modes: [local, hosted]
depends_on: [267, 268, 286]
status: done
claimed_by: codex-290
issue: 465
---

## What the user does
As a board owner, an agent narrowed to reading and posting in a channel claims none of its tasks.

## Done when
- [x] narrowed with `x-board-can: dev=read,post`, a caller reads task 2's thread as `ready`, but `POST /tasks/2/claim` and `POST /tasks/claim { "channel": "dev" }` answer 403 `forbidden` and 2 stays `ready`
- [x] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/takes label in its channel to claim a task: a caller narrowed to reading and posting claims none`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Narrowed prerequisites (291) and profiles (292).

## Notes
`claimTask` (242) and `claimReadyTask` (265) declare `label`; if one does not, fix it here. Depends on 268 as well: both change `task-queue.ts`.
