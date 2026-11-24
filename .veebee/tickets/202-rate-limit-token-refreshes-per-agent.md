---
id: 202
title: Rate-limit token refreshes per agent
milestone: M7-hosted-deploy
package: server
writes:
  - packages/server/src/operations/connections.ts
  - packages/server/test/auth/refresh-limit.test.ts
conformance: []
modes: [local, hosted]
depends_on: [201]
status: draft
claimed_by: null
issue: 363
---

## What the user does
As the operator of a shared instance, an agent that refreshes its token in a loop is held to six refreshes a minute and told when to try again.

## Done when
- [ ] `bun test packages/server/test/auth/refresh-limit.test.ts` passes: six refreshes of one agent within a minute succeed, the seventh answers 429 `rate_limited` with a `retry-after` and leaves the current token valid, another agent of the same connection refreshes meanwhile, and the agent refreshes again once the fake clock has moved a minute

## Out of scope
- Claims (201); the token lifetimes themselves (122, 123).

## Notes
- docs/auth.md "Rate limits" (refresh per agent: 6/min, per instance, with the limiter of 199). The handler is `refreshAgentTokenHandler` in `packages/server/src/operations/connections.ts`; key on the agent ID the `obt_` token names, checked before the board-locked write.
- Depends on 201 because both change `packages/server/src/operations/connections.ts`.
