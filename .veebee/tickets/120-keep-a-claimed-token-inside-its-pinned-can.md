---
id: 120
title: Keep a claimed token inside its pinned can
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/tokens.ts
  - packages/server/test/auth/pinned.test.ts
conformance: []
modes: [local]
depends_on: [119]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an orchestrator, the token I hand a sandbox can do only what I claimed it for.

## Done when
- [ ] a token claimed with `"can": {"dev": ["read"]}` reads `dev`, gets `error: forbidden` posting there, and `ob whoami` shows `can dev read`

## Out of scope
- `x-board-can` on other callers (M10, 286).

## Notes
`docs/auth.md` mode 2 ("Pinned narrowing").
