---
id: 332
title: Revoke an agent from an inbound rule
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/core/src/inbound/actions.ts
  - packages/core/test/inbound/actions.test.ts
  - packages/server/src/inbound/run.ts
  - packages/server/src/operations/inbound.ts
  - packages/server/test/inbound/revoke.test.ts
conformance: []
modes: [local, hosted]
depends_on: [331]
status: draft
claimed_by: null
issue: 517
---

## What the user does
As a board owner, when the runner reports a sandbox gone, the agent token that sandbox held stops working at once, while the connection and its other agents keep going.

## Done when
- [ ] `bun test packages/server/test/inbound/revoke.test.ts` passes: `{ "agents.revoke": { "connection": "cn_…", "profile": "{{thread.claim.profile}}" } }` revokes the live agent of that connection holding that profile, so its `obt_` tokens answer 401 from the next request and the profile is free; no live agent is `{ "agents.revoke": "none" }` in `results`; creating or changing an endpoint with this action needs the creator to manage that connection (board owner or organization admin), else 403 `forbidden`; a connection of another board is refused at creation with 400 `invalid_rule`

## Out of scope
- Revoking a whole connection from a rule (not in the closed list).

## Notes
docs/protocol.md "Inbound endpoints" (`agents.revoke` with `connection` and `profile`) and "Board extensions" (`POST /x/connections/:id/agents/:agent/revoke`), docs/auth.md "Per-agent revoke" ("also an inbound-rule action"). Reuse the decision behind `revokeAgentHandler` (`packages/server/src/operations/connections.ts`) rather than calling the route. The creation check sits in `packages/server/src/operations/inbound.ts`.
