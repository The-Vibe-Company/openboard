---
id: 353
title: Serve a proxy policy for injecting gateways
milestone: M12-mcp-sdk-skill
package: server
writes:
  - packages/contract/src/operations/connection-policy.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/access/policy.ts
  - packages/core/test/access/policy.test.ts
  - packages/server/src/operations/connection-policy.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/connections/policy.test.ts
conformance: []
modes: [local, hosted]
depends_on: [286]
status: draft
claimed_by: null
issue: 538
---

## What the user does
As an orchestrator that runs agents behind an egress proxy or an MCP gateway, I fetch `ob connections policy <id> --as fixer-2 --can 'work/fix/=read,post'` and configure the proxy with it, so the secret stays outside the sandbox and the agent sees only a placeholder token.

## Done when
- [ ] `bun test packages/server/test/connections/policy.test.ts` passes: `GET /x/connections/:id/policy?profile=fixer-2&can=work/fix/=read,post` on a direct connection answers `{ env: { BOARD_URL, BOARD_TOKEN: "<placeholder>", BOARD_PROFILE: "fixer-2" }, headers: { authorization: "Bearer ${OPENBOARD_SECRET}", "x-board-profile": "fixer-2", "x-board-can": "work/fix/=read,post" }, routes }`, where `routes` lists the method and path patterns under `BOARD_URL` and `/mcp/<org>/<board>` an agent may reach, and leaves out grants, watchers, sync's records, schema registration, `/x/*` configuration and every `/api/x` route; no field holds the secret
- [ ] in the same file: a profile outside the connection's `profiles`, or a `can` wider than its grant, answers 400 `invalid_request`; a connection that is not direct answers 400 `invalid_request` ("a proxy injects a direct connection's secret; claim a token instead"); the caller must be a board owner or organization admin (403 `forbidden` otherwise, 401 for an `obt_` token's board mismatch, 404 for another organization)

## Out of scope
- Running a proxy (354 shows one in a recipe); refusing what the proxy refuses on the server side, already done for claimed tokens (121).

## Notes
docs/auth.md "Mode 3, injecting proxy or MCP gateway" (`GET {BOARD_URL}/x/connections/:id/policy?profile=…&can=…` returns `{ env, headers, routes }`; for an MCP gateway, point it at `/mcp/<org>/<board>` with the same headers) and upstream `sandboxPolicy()` (`docs/03-guides/06-sandboxed-agents.md`: `allow` lists the board's host and its routes; the proxy refuses grants, watchers, sync's records, webhooks, wake-ups). The route list is derived from the contract (`operations`), filtered by the same rule as `refuseClaimedConfiguration` (`packages/server/src/auth/tokens.ts`), so it cannot drift. `${OPENBOARD_SECRET}` is a literal placeholder the proxy fills from its own store.

Orchestrator note: depends on 286 (`x-board-can` narrowing, which this policy enforces; found by the ticket's agent on #538). The dependency on 215 (serving production) was dropped: it ordered milestones, it is not a technical need, and 215 waits on the owner's production secrets.
