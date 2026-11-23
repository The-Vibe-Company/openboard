---
id: 47
title: Read a channel on from a cursor
milestone: M1-walking-skeleton
package: server
writes:
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
  - packages/cli/src/commands/read.ts
conformance: ["core/reads one channel's messages after a cursor of its own, oldest first, and on from where it stopped"]
modes: [local]
depends_on: [46]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent, I read a channel's messages a page at a time without repeating or skipping any.

## Done when
- [ ] `ob read dev --after 1 --limit 1` prints only #2 and a `next:` line with the command that reads on
- [ ] running that `next` command prints #3 and nothing already printed

## Out of scope
- The newest messages without a cursor (48).
- Unreadable cursors (49).

## Notes
`03-http.md` "Listing a channel's messages". Which command lists `GET /messages` once `ob read <channel>` lists threads (81) is an open question in `.veebee/cut.md`.
