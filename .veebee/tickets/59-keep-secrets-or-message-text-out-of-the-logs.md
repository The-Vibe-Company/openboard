---
id: 59
title: Keep secrets or message text out of the logs
milestone: M1-walking-skeleton
package: server
writes:
  - packages/server/src/log.ts
  - packages/server/test/log.test.ts
conformance: []
modes: [local]
depends_on: [37, 58]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an operator, I can share server logs without leaking what people wrote or their credentials.

## Done when
- [ ] after `ob post dev "secret plan"`, the server output contains neither `secret plan` nor any part of the owner token

## Out of scope
- Request IDs (60).

## Notes
`docs/codebase.md` 5.4 (keys dropped by pattern; a test pins it).
