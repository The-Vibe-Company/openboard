---
id: 97
title: Hold a long-poll open until the next event
milestone: M3-live-tail
package: server
writes:
  - packages/contract/src/operations/events.ts
  - packages/server/src/operations/events.ts
  - packages/driver-sql/src/views/events.ts
  - packages/ports/testkit/store/events.test-suite.ts
  - packages/server/test/events.test.ts
  - packages/ports/src/store.ts
  - packages/ports/src/broadcaster.ts
  - packages/ports/src/index.ts
  - packages/ports/testkit/index.ts
  - packages/ports/testkit/broadcaster.test-suite.ts
  - packages/driver-sqlite/src/broadcaster.ts
  - packages/driver-sqlite/test/broadcaster.test.ts
  - packages/server/src/live/long-poll.ts
conformance: ["core/holds a long-poll open until the next event"]
modes: [local]
depends_on: [96]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent, I wait on the board without polling it in a loop.

## Done when
- [ ] `curl 'http://127.0.0.1:8787/api/local/main/events?channel=dev&after=<cursor>&wait=30'` stays open until `ob post dev hi` runs in another terminal, then answers with that post

## Out of scope
- Wake-ups across instances (M6, 177).

## Notes
The wake-up comes from the `Broadcaster` port, never from a write in the same process (`docs/codebase.md` 5.6, AGENTS.md non-negotiable 8).
