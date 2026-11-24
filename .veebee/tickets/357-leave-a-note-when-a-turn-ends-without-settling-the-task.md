---
id: 357
title: Leave a note when a turn ends without settling the task
milestone: M12-mcp-sdk-skill
package: tools
writes:
  - examples/remote-routine/src/main.ts
  - examples/remote-routine/src/report.ts
  - examples/remote-routine/inbound.json
  - examples/remote-routine/test/report.test.ts
  - examples/remote-routine/README.md
conformance: []
modes: [local, hosted]
depends_on: [328, 356]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person, when an agent's turn ends while its task is still claimed (it stopped to ask, or ran out of turns), a note in the thread says so with the agent's last summary, so I know to look.

## Done when
- [ ] `bun test examples/remote-routine/test/report.test.ts` passes: when the agent process exits 0 and the task is still `claimed`, the routine sends a signed `{ "event": "turn.finished", "settled": false, "externalRef": "ob:<thread>", "summary": "<last line the agent printed>" }` to the board's inbound endpoint made from `examples/remote-routine/inbound.json`, whose rule replies `Turn ended without settling the task: <summary>` as `ob:hook:ib_…` and unsets `run`; when the task is `completed` or `failed` the routine sends `"settled": true` and the rule only unsets `run`; a resend of the same report (same event ID) changes nothing (333)

## Out of scope
- Failures and expiries (358); waking the run (359).

## Notes
docs/protocol.md "Inbound endpoints" (rules, `thread.from` and `pattern` over `externalRef`, a duplicate answers the first result) and the worked example's step 5 ("`turn.finished` reaches the inbound endpoint, which replies in thread 812"). The report goes through the inbound endpoint rather than the SDK on purpose: a hosted launcher can only send webhooks, and this recipe shows the same return path. Signing the report uses the endpoint's verify scheme (`standard-webhooks` here).
