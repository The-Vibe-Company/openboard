---
id: 129
title: Revoke one agent of a connection
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/connections.ts
  - packages/server/src/operations/connections.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/ports/testkit/store/connections.test-suite.ts
  - packages/server/test/connections.test.ts
  - packages/ports/src/store.ts
  - packages/server/test/auth/revoke-agent.test.ts
conformance: []
modes: [local]
depends_on: [128]
status: draft
claimed_by: null
issue: 130
---

## What the user does
As an orchestrator, I stop one sandbox's agent without touching the others.

## Done when
- [ ] `curl -X POST http://127.0.0.1:8787/api/local/main/x/connections/<id>/agents/<agent>/revoke` makes that agent's token answer 401 while another agent of the same connection keeps working

## Out of scope
- The inbound rule that does it (M11, 332).

## Notes
`docs/auth.md` mode 2 ("Per-agent revoke").
