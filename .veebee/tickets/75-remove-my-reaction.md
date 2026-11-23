---
id: 75
title: Remove my reaction
milestone: M2-messages-and-threads
package: core
writes:
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/messages/reactions.ts
  - packages/core/test/messages/reactions.test.ts
conformance: []
modes: [local]
depends_on: [74]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person or agent, I take back a reaction.

## Done when
- [ ] `ob react 1 eyes --remove` leaves `reactions` without my actor under `eyes`

## Out of scope
- Labels (77).

## Notes
`reaction.removed`.
