---
id: 157
title: Choose the board the CLI talks to
milestone: M4-accounts-organizations-and-auth
package: cli
writes:
  - packages/cli/src/commands/use.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/src/config.ts
  - packages/cli/test/use.test.ts
conformance: []
modes: [local]
depends_on: [153, 156]
status: draft
claimed_by: null
issue: 158
---

## What the user does
As a person with several boards, I point the CLI at one of them.

## Done when
- [ ] `ob use ops` then `ob post dev hi` posts to `acme/ops`; `ob use acme/main` switches back

## Out of scope
- Switching organizations: one per person in v1.

## Notes
`docs/auth.md` "CLI sign-in" step 4.
