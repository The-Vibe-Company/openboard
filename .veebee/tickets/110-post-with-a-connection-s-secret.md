---
id: 110
title: Post with a connection's secret
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/connections.ts
  - packages/server/src/auth/chain.ts
  - packages/server/test/auth/direct.test.ts
conformance: []
modes: [local]
depends_on: [109]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent on a laptop, I use the connection's secret directly as my board token.

## Done when
- [ ] `BOARD_TOKEN="$(cat laptop.secret)" ob post dev hi` posts, and `ob read dev` shows it by `laptop`
- [ ] `BOARD_TOKEN="$(cat laptop.secret)" ob whoami` prints `laptop`, principal `ob:conn:cn_…` and credential `connection`

## Out of scope
- Profiles (112).
- Non-direct secrets (127).

## Notes
`docs/auth.md` "Three ways to connect", mode 1; verifier chain step 2.
