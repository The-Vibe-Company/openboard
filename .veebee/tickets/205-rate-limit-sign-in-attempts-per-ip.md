---
id: 205
title: Rate-limit sign-in attempts per IP
milestone: M7-hosted-deploy
package: server
writes:
  - packages/server/src/auth/providers/index.ts
  - packages/server/test/auth/sign-in-limit.test.ts
conformance: []
modes: [local, hosted]
depends_on: [195, 199]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the operator of a shared instance, one IP starting browser sign-ins in a loop is held to 30 a minute, so it cannot hammer the identity provider through us.

## Done when
- [ ] `bun test packages/server/test/auth/sign-in-limit.test.ts` passes: thirty `GET /auth/github/start` from one IP within a minute redirect to the provider, the 31st answers 429 `rate_limited` with a `retry-after` and calls nothing, callbacks from that IP count toward the same limit, another IP signs in meanwhile, and the IP is admitted again once the fake clock has moved a minute

## Out of scope
- Failed bearer authentication (200); organization creation (203).
- The device flow's poll interval, already answered 429 (156).

## Notes
- docs/auth.md "Rate limits" (sign-in attempts per IP: 30/min, per instance). `/auth/<provider>/start|callback` run before the `/api` router (D48) in `signInRoute` (`packages/server/src/auth/providers/index.ts`); the limiter and the client IP reach its context from 199.
- The answer is JSON 429 at a browser route outside `/api`; a friendlier page is the front's (M8).
- Depends on 195 because both change `packages/server/src/auth/providers/index.ts`.
