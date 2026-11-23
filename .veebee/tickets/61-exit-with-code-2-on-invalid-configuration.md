---
id: 61
title: Exit with code 2 on invalid configuration
milestone: M1-walking-skeleton
package: app
writes:
  - apps/openboard/src/config.ts
  - apps/openboard/test/config.test.ts
conformance: []
modes: [local]
depends_on: [40]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an operator, a typo in my configuration stops the server with a clear message instead of a half-working board.

## Done when
- [ ] `PORT=abc ob serve` and `OPENBOARD_LOG_LEVEL=loud ob serve` each exit 2 naming the bad variable

## Out of scope
- Secrets set twice (62).

## Notes
`docs/codebase.md` 5.5.
