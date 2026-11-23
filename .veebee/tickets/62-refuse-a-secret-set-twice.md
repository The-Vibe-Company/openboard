---
id: 62
title: Refuse a secret set twice
milestone: M1-walking-skeleton
package: app
writes:
  - apps/openboard/src/config.ts
  - apps/openboard/test/config.test.ts
conformance: []
modes: [local]
depends_on: [61]
status: done
claimed_by: Codex
issue: 62
---

## What the user does
As an operator, I am stopped when a secret is given twice and I would not know which one wins.

## Done when
- [x] setting both `OPENBOARD_SECRET_KEY` and `OPENBOARD_SECRET_KEY_FILE` makes `ob serve` exit 2 naming both

## Out of scope
- Secrets on the command line: no option takes one (D42).

## Notes
`docs/codebase.md` 5.5 (`_FILE` variant).
