---
id: 200
title: Rate-limit failed authentication per IP
milestone: M7-hosted-deploy
package: server
writes:
  - packages/server/src/auth/chain.ts
  - packages/server/test/auth/failed-auth-limit.test.ts
conformance: []
modes: [local, hosted]
depends_on: [199]
status: draft
claimed_by: null
issue: 361
---

## What the user does
As the operator of a shared instance, a client guessing tokens from one IP is stopped after 20 failures a minute, without checking any more of its guesses.

## Done when
- [ ] `bun test packages/server/test/auth/failed-auth-limit.test.ts` passes: twenty requests from one IP with a wrong bearer answer 401 `unauthorized`, the 21st within the minute answers 429 `rate_limited` with a `retry-after` before any credential lookup (the store sees no lookup), a valid credential from another IP passes meanwhile, and the IP is admitted again once the fake clock has moved a minute
- [ ] in the same file, successful requests never count toward the limit, and the 429 carries no hint about which part of the credential was wrong

## Out of scope
- Sign-in attempts at `/auth` (205); claims (201) and refreshes (202).
- Blocking an IP across instances: this limit is per instance (docs/auth.md "Rate limits").

## Notes
- docs/auth.md "Rate limits" (failed authentication per IP: 20/min, per instance) and "Threat model". The limiter and the client IP reach the verifier chain from 199; count only failures that end in 401 `unauthorized` (an unknown or revoked token, a token bound to another board), not 404s for boards the caller cannot reach.
- The IP is not logged in full: the request log keeps its fields (docs/codebase.md 5.4).
