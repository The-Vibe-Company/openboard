---
id: 319
title: Fire only when a task becomes ready
milestone: M11-webhooks-and-watchers
package: core
writes:
  - packages/core/src/webhooks/filter.ts
  - packages/core/test/webhooks/filter.test.ts
  - packages/server/test/webhooks/became.test.ts
conformance: []
modes: [local, hosted]
depends_on: [254, 304]
status: draft
claimed_by: null
issue: 504
---

## What the user does
As a board admin, I subscribe a runner with `"became": { "task": "ready" }` and it is called once each time a task in `work/` becomes workable, whatever event made it so, and never for the replies or label changes in between.

## Done when
- [ ] `bun test packages/server/test/webhooks/became.test.ts` passes with `{ "tail": "work/", "became": { "task": "ready" } }`: a task created ready, a waiting task whose last need completes, a released claim, an expired lease, a reopened task and an unblocked task each send exactly one delivery for the event that made it ready; a reply in the thread, a label change, a claim and a completion send none; `subject.task.state` is `ready` in each
- [ ] `bun test packages/core/test/webhooks/filter.test.ts` passes: `became` is decided from the root's task state before and after each event, so two events in one write that leave the task ready once fire once; `became` with `types` keeps only both; an unknown state or key answers 400 `invalid_request`

## Out of scope
- `became` on labels (a label taking a value): not in the cut, listed as a gap in the PR that wrote this ticket.
- Launching anything on the receiving side (355).

## Notes
docs/protocol.md "Subscription" ("`became` fires on a state transition computed in the writing transaction (the common 'a task is workable now' trigger)") and the worked example's `"became": { "task": "ready" }`. 304 matches each event with the message before and after it, so this ticket changes `filter.ts` alone. The events that make a task ready are 254's (`task.ready`), 245's expiry, 247's release, 251's reopen and 263's unblock.
