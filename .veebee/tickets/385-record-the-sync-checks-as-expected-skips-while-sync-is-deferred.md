---
id: 385
title: Record the sync checks as expected skips while sync is deferred
milestone: M14-external-sync
package: tools
writes:
  - tools/conformance/score.json
  - tools/conformance/test/score.test.ts
conformance: []
modes: [local, hosted]
depends_on: [272, 293, 384]
status: done
claimed_by: codex
issue: 580
---

## What the user does
As the owner, the conformance score says which sync checks OpenBoard skips on purpose and why, so the day one of them passes or fails instead, the run says so.

## Done when
- [ ] `tools/conformance/score.json` `expectedSkips` names, each with the reason "platform sync is deferred (D19)": `sync/keeps sync's records: an import as a profile of its importer, its lookups by platform ID, a receipt, and where it's synced`, `sync/meets a platform user an import's text mentions: an actor as one who wrote would be, whom the text names by that actor's ID`, `sync/queues a platform thread's events in its sync's inbox once, and leases each after the one before is acked`, `sync/takes an edit of a long message in its sync's inbox, under the longest event ID the protocol allows, and refuses a longer one`, `sync/hands a sync each message change as a match of its @sync watcher`, `sync/refuses a caller narrowed with x-board-can sync's records: imports, receipts, and the inbox`, and `tasks/holds a task when anyone but its owner edits its root, which ends its claim`
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` print those seven as expected skips with their reason and exit 0, and exit 1 when one of them passes or fails instead (`bun test tools/conformance/test/score.test.ts` covers both); every one of upstream's 91 checks is then recorded or expected to skip in both modes

## Out of scope
- Building sync (386), after which the owner removes these entries.
- The root-edit rule itself, built and tested without the kit (272).

## Notes
- docs/project.md M14 ("While D19 defers platform sync, these are recorded as `expectedSkips` with D19 as the reason, by the owner"), D19, docs/codebase.md 6.3, and the `expectedSkips` mechanism of 293. The owner approves the entries in review (AGENTS.md non-negotiable 4: removing or weakening a conformance entry is the owner's call).
- `sync/keeps noSync on a post and a reply, so sync sends neither` passes and stays recorded (69); it is not one of the seven.
- Depends on 293, which lands `expectedSkips` and last changes `tools/conformance/score.json`'s shape and its test.
