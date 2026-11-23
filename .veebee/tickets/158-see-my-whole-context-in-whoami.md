---
id: 158
title: See my whole context in whoami
milestone: M4-accounts-organizations-and-auth
package: cli
writes:
  - packages/cli/src/commands/whoami.ts
  - packages/cli/test/whoami.test.ts
conformance: []
modes: [local]
depends_on: [157]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person, one command tells me who I am, where, with what credential and rights.

## Done when
- [ ] after `ob login`, `ob whoami` prints the four lines of `docs/auth.md` (person and credential with its expiry, organization and role, board and URL, can)

## Out of scope
- Agents' view (118).

## Notes
`docs/auth.md` "CLI sign-in".
