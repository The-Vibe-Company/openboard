---
id: 269
title: Follow a feed of tasks becoming ready
milestone: M9-tasks
package: server
writes:
  - packages/server/src/operations/events.ts
  - packages/driver-sql/src/views/events.ts
  - packages/server/test/tasks/ready-feed.test.ts
conformance: ["tasks/shows a feed that filters on board.task=ready a task becoming ready and being claimed, and never a token"]
modes: [local, hosted]
depends_on: [267]
status: draft
claimed_by: null
issue: 443
---

## What the user does
As a dispatcher, I follow only tasks becoming ready, `GET /events?label=board.task=ready`, and never see a claim's token.

## Done when
- [ ] `bun test packages/server/test/tasks/ready-feed.test.ts` passes: a feed filtered on `channel` and `label=board.task=ready` shows a task's `task.ready`, then its `task.claimed` (its message matched before the claim) with `message.task.state` `claimed`, and no event's `payload` or `message` holds a claim's token
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/shows a feed that filters on board.task=ready a task becoming ready and being claimed, and never a token`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Webhooks firing on `became: { task: "ready" }` (M11).

## Notes
95's rule: an event is delivered when its message matches the filter before or after it (`03-http.md` "Filters"); `ob tail dev --label board.task=ready` (105) shows the same.
