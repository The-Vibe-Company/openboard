---
id: 93
title: Answer created: false for a channel that already exists
milestone: M2-messages-and-threads
package: server
writes:
  - packages/server/src/operations/channels.ts
  - packages/server/test/channels.test.ts
  - packages/core/src/channels/create.ts
conformance: ["core/creates a channel only once: one a post made is there already"]
modes: [local]
depends_on: [51, 92]
status: done
claimed_by: codex
issue: 93
---

## What the user does
As an agent, creating a channel that exists is harmless and tells me so.

## Done when
- [x] `ob channels create dev` after a post in `dev` reports `created: false`
- [x] `ob channels create 'Not A Channel'` prints `error: invalid_request` and exits 1

## Out of scope
- Deleting channels: not in the protocol.

## Notes
`vb channels create` reference.
