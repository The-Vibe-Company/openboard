---
id: 380
title: Let a profile cancel only its own schedules
milestone: M13-data-files-schedules
package: server
writes:
  - packages/core/src/schedules/cancel.ts
  - packages/core/test/schedules/cancel.test.ts
  - packages/server/src/operations/schedules.ts
  - packages/server/test/schedules/ownership.test.ts
conformance: []
modes: [local, hosted]
depends_on: [375]
status: draft
claimed_by: null
issue: 575
---

## What the user does
As one of several agents sharing a connection, I can cancel the reminders I scheduled, but not the ones another agent of the same connection scheduled.

## Done when
- [ ] `bun test packages/server/test/schedules/ownership.test.ts` passes on SQLite and Postgres: a schedule made as `fixer` is canceled by `fixer` (`--as fixer`) and by the connection's principal as itself, refused to `reviewer` with 403 `forbidden`, and canceled by anyone with `manage` in its channel; a creator that can no longer read the channel cancels and lists only the schedules it made there, without seeing their text
- [ ] `ob schedule cancel s1 --as reviewer` on a schedule made `--as fixer` prints `error: forbidden: …` and the schedule stays pending

## Out of scope
- Who may edit or delete messages (116); who may change tasks (292).

## Notes
- Upstream `docs/01-board/07-schedules.md` "Listing and canceling" ("Its creator is the profile that made it, or its principal as itself, with no profile, as Who edits what says. A creator that can't read the channel lists and cancels only the schedules it made there without reading"), the same rule 116 applies to messages (`packages/core/src/messages/ownership.ts`): reuse it.
- The schedule stores its creator's actor, principal and profile (373); a view for a creator that cannot read hides `text` as upstream's blind views do (`blind` in docs/data-model.md `schedules`).
