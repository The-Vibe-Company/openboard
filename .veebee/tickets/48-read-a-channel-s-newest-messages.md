---
id: 48
title: Read a channel's newest messages
milestone: M1-walking-skeleton
package: server
writes:
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
conformance: ["core/reads one channel's newest messages, as many as it's asked for"]
modes: [local]
depends_on: [47]
status: draft
claimed_by: null
issue: 48
---

## What the user does
As an agent arriving late, I read only the newest messages of a channel.

## Done when
- [ ] with five messages in `dev`, `ob read dev --limit 2` prints the two newest, oldest first, and a `next:` line that reads on from them

## Out of scope
- Thread lists (81).

## Notes
`03-http.md` "Listing a channel's messages" (without `after`, the latest `limit`).
