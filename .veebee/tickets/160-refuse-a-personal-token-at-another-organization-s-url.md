---
id: 160
title: Refuse a personal token at another organization's URL
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - .veebee/tickets/160-refuse-a-personal-token-at-another-organization-s-url.md
  - packages/server/src/auth/personal-tokens.ts
  - packages/server/test/auth/personal-token-org.test.ts
conformance: []
modes: [local]
depends_on: [155, 159]
status: done
claimed_by: codex-t160
issue: 161
---

## What the user does
As an organization, a token issued for someone else's organization opens nothing here.

## Done when
- [x] an `obp_` token issued for `acme` answers 404 `not_found` at `http://127.0.0.1:8787/api/beta/main/me`

## Out of scope
- Sessions, which are per person (155).

## Notes
Verifier chain step 3 (`docs/auth.md`).
