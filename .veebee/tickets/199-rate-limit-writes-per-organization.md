---
id: 199
title: Rate-limit writes per organization
milestone: M7-hosted-deploy
package: server
writes:
  - .veebee/tickets/199-rate-limit-writes-per-organization.md
  - packages/contract/src/operation.ts
  - docs/codebase.md
  - packages/ports/src/index.ts
  - packages/ports/src/seams.ts
  - packages/server/src/auth/providers/index.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/http/limits.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/http/openapi.ts
  - packages/server/openapi.json
  - packages/server/test/openapi.test.ts
  - packages/server/src/http/errors.ts
  - packages/server/src/app.ts
  - packages/server/test/rate-limits.test.ts
  - apps/openboard/src/serve.ts
  - docs/decisions.md
  - skills/openboard/references/commands.md
  - tools/bench/src/drivers.ts
  - tools/bench/src/workloads/request.ts
  - packages/server/src/operations/channels.ts
  - packages/server/src/operations/connections.ts
  - packages/server/src/operations/grants/create.ts
  - packages/server/src/operations/grants/revoke.ts
  - packages/server/src/operations/grants/update.ts
  - packages/server/src/operations/messages.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/src/operations/tasks/claim.ts
  - packages/server/src/operations/tasks/complete.ts
  - packages/server/src/operations/tasks/renew.ts
  - packages/server/src/operations/memberships.ts
  - packages/ports/src/store.ts
  - packages/driver-sql/src/views/memberships.ts
  - packages/server/src/operations/boards.ts
  - packages/server/src/operations/invitations.ts
  - packages/driver-sql/src/views/boards.ts
  - packages/driver-sql/src/views/invitations.ts
conformance: []
modes: [local, hosted]
depends_on: [181, 184, 188, 196]
status: done
claimed_by: Codex
issue: 360
---

## What the user does
As the operator of a shared instance, one organization writing in a loop is slowed with `rate_limited` and a `retry-after`, while other organizations and every reader keep their speed.

## Done when
- [x] `bun test packages/server/test/rate-limits.test.ts` passes: 1,000 writes for one organization in the same instant pass, the next answers 429 `rate_limited` with `retry-after: 1` and writes nothing, another organization's write on the same instance passes, reads are never limited, and after the fake clock advances one second 200 more writes pass
- [x] `bun run conformance` and `bun run bench --quick` report the same score and counters as before: the limit never bites the kit or the bench

## Out of scope
- The other limits of docs/auth.md "Rate limits": failed authentication (200), claims (201), refreshes (202), organization creation (203), invitations (204), sign-in attempts (205), open streams (206).
- Per-organization webhook delivery caps (M11, 324).

## Notes
- docs/auth.md "Rate limits" (writes per organization: 200/s, burst 1,000, per instance, so the sum across instances is about the configured rate times the instances), docs/codebase.md 4.4 step 4 and 4.5, D40. 429 `rate_limited` with `retry-after` (docs/protocol.md "Error envelope").
- Hot-path limits are token buckets per instance that hang off `createApp` (docs/codebase.md 5.6: no module-level state; time from `deps.now`), so a write pays no database round trip; limits that must hold across instances go to the database (201). The orchestrator confirmed the per-instance policy from docs/auth.md and docs/architecture.md "SaaS seams" on #360.
- This ticket also lands what 200 to 206 key on, so they need not touch `pipeline.ts` or `app.ts` again: the limiter on the pipeline, the sign-in context and the handler context, and the client's IP. `app.fetch(request, { ip })` receives it from `apps/openboard/src/serve.ts` (Bun's `server.requestIP`); it is socket metadata only. Per-IP limits and forwarded-IP trust belong to tickets 200 and 205. Per-organization writes debit the bucket after authorization, per the orchestrator decision on #360.
- Depends on 184 (after 183) and 188, the last tickets before it to change `packages/server/src/app.ts`, `http/pipeline.ts` and `apps/openboard/src/serve.ts`, and on 196, whose handlers in `packages/server/src/operations/` the limits of 201 to 204 change next.
