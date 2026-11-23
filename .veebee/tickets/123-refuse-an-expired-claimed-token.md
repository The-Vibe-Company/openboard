---
id: 123
title: Refuse an expired claimed token
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/tokens.ts
  - packages/server/test/auth/expired.test.ts
  - packages/server/test/auth/refresh.test.ts
conformance: []
modes: [local]
depends_on: [122]
status: claimed
claimed_by: claude-opus-t123
issue: 124
---

## What the user does
As an owner, a token past its life stops working on its own.

## Done when
- [ ] a token claimed with `"ttl": "5m"` makes `ob whoami` print `error: unauthorized` once five minutes have passed

## Out of scope
- Revocation (128).

## Notes
`tokenTtl`, `tokenMax` (`docs/auth.md` "Connections").
