---
id: 358
title: Return the task when a run fails or expires
milestone: M12-mcp-sdk-skill
package: tools
writes:
  - examples/remote-routine/src/main.ts
  - examples/remote-routine/src/launch.ts
  - examples/remote-routine/src/report.ts
  - examples/remote-routine/inbound.json
  - examples/remote-routine/test/fail.test.ts
  - examples/remote-routine/test/launch.test.ts
  - examples/remote-routine/test/report.test.ts
  - examples/remote-routine/test/support.ts
  - examples/remote-routine/README.md
conformance: []
modes: [local, hosted]
depends_on: [331, 332, 357]
status: done
claimed_by: codex
issue: 543
---

## What the user does
As a team lead, when an agent crashes or its run is stopped for taking too long, its task is claimable again at once and a new run picks it up, without anyone noticing a stuck claim.

## Done when
- [x] `bun test examples/remote-routine/test/fail.test.ts` passes: an agent that claims and exits 1 makes the routine send `run.failed`, one still running at `RUN_TIMEOUT` is killed and sends `run.expired`; the inbound rules of `inbound.json` end the claim (`task.expire`), revoke the run's agent (`agents.revoke` for `{{thread.claim.profile}}`) and reply `Run <id> failed; the task is claimable again.`; the task is `ready`, the `became` webhook fires once more, and a second run with a fresh token completes it; the first run's token answers 401 afterwards

## Out of scope
- Stopping after repeated failures (rules have no counters; a hold by a person, 262, stops the loop).

## Notes
docs/protocol.md "Inbound endpoints" (the `sandbox.stopped`/`sandbox.expired` rule: `task.expire`, `agents.revoke`, a reply; "the task is ready again, which fires step 2 for a new sandbox"), D18, docs/auth.md "Per-agent revoke". Event names are the recipe's own (`run.failed`, `run.expired`), mapped by its rules; a hosted launcher's names go in its own rules file.
