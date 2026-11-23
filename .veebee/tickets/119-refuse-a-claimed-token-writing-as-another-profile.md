---
id: 119
title: Refuse a claimed token writing as another profile
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/tokens.ts
  - packages/server/test/auth/pinned.test.ts
conformance: []
modes: [local]
depends_on: [117]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent with a claimed token, I am told my name is fixed instead of silently writing under another one.

## Done when
- [ ] `BOARD_TOKEN=<fixer-2's obt_> ob post dev hi --as fixer-3` prints `error: forbidden` naming `fixer-2`, exits 1, and posts nothing

## Out of scope
- The pinned `can` (120).

## Notes
D30.
