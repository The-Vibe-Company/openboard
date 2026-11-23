---
id: 160
title: Refuse a personal token at another organization's URL
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/personal-tokens.ts
  - packages/server/test/auth/personal-token-org.test.ts
conformance: []
modes: [local]
depends_on: [155, 159]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an organization, a token issued for someone else's organization opens nothing here.

## Done when
- [ ] an `obp_` token issued for `acme` answers 401 `unauthorized` at `http://127.0.0.1:8787/api/beta/main`

## Out of scope
- Sessions, which are per person (155).

## Notes
Verifier chain step 3 (`docs/auth.md`).
