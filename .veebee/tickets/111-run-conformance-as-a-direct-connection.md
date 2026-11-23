---
id: 111
title: Run conformance as a direct connection
milestone: M4-accounts-organizations-and-auth
package: tools
writes:
  - tools/conformance/src/run.ts
conformance: []
modes: [local]
depends_on: [54, 110]
status: draft
claimed_by: null
issue: 111
---

## What the user does
As a contributor, conformance runs as an ordinary connection, not as the owner, so the lockout check can run.

## Done when
- [ ] `bun run conformance` creates a direct connection with `*=all` on `local/main` with the local owner token and runs the kit with its secret; the score does not drop

## Out of scope
- The hosted conformance organization (M5, 170).

## Notes
D43; `docs/auth.md` "The credential that runs conformance".
