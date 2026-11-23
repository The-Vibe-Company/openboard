---
id: 92
title: Create a channel
milestone: M2-messages-and-threads
package: server
writes:
  - packages/contract/src/operations/channels.ts
  - packages/server/src/operations/channels.ts
  - packages/driver-sql/src/views/channels.ts
  - packages/server/test/channels.test.ts
  - packages/core/src/channels/create.ts
  - packages/core/test/channels/create.test.ts
conformance: []
modes: [local]
depends_on: [91]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person, I create a channel before anyone posts in it.

## Done when
- [ ] `ob channels create dev/alerts` reports it created, and `ob channels` lists it with no messages

## Out of scope
- Private channels and their grants (M10, 294).

## Notes
`channel.created` (`03-http.md` "Event types").
