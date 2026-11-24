---
id: 205
title: Rate-limit sign-in attempts per IP
milestone: M7-hosted-deploy
package: server
writes:
  - .veebee/tickets/205-rate-limit-sign-in-attempts-per-ip.md
  - docs/auth.md
  - docs/data-model.md
  - docs/decisions.md
  - packages/driver-sql/migrations/0019-rate-counters.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/rates/index.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/ports/src/seams.ts
  - packages/ports/src/store.ts
  - packages/server/src/app.ts
  - packages/server/src/http/limits.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/auth/providers/index.ts
  - packages/server/test/auth/sign-in-limit.test.ts
conformance: []
modes: [local, hosted]
depends_on: [195, 199]
status: done
claimed_by: Codex
issue: 366
---

## What the user does
As the operator of a shared deployment, one IP starting browser sign-ins in a loop is held to 30 a minute, so it cannot hammer the identity provider through us.

## Done when
- [x] `bun test packages/server/test/auth/sign-in-limit.test.ts` passes: thirty `GET /auth/github/start` from one IP within a minute redirect to the provider, the 31st answers 429 `rate_limited` with a `retry-after` and calls nothing, callbacks from that IP count toward the same limit, another IP signs in meanwhile, and the IP is admitted again once the fake clock has moved a minute. The same test alternates instances with the Postgres driver.

- [x] `bun test apps/openboard/test/client-ip.test.ts` passes with spoofed forwarding headers in both default and trusted-proxy modes.

## Out of scope
- Failed bearer authentication (200); organization creation (203).
- The device flow's poll interval, already answered 429 (156).

## Notes
- docs/auth.md "Rate limits" (sign-in attempts per IP: 30/min, shared across hosted replicas). `/auth/<provider>/start|callback` run before the `/api` router (D48) in `signInRoute` (`packages/server/src/auth/providers/index.ts`); the limiter and the client IP reach its context from 199.
- The owner decision on #366 specifies a shared Postgres counter behind `RateLimits`, using SQLite locally. Use the socket IP by default. When `OPENBOARD_TRUSTED_PROXIES` is set to a hop count, select the IP that many entries from the right in `X-Forwarded-For`.
- The answer is JSON 429 at a browser route outside `/api`; a friendlier page is the front's (M8).
- Depends on 195 because both change `packages/server/src/auth/providers/index.ts`.
