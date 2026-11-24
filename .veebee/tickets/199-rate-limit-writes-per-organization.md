---
id: 199
title: Rate-limit writes per organization
milestone: M7-hosted-deploy
package: server
writes:
  - packages/server/src/http/limits.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/http/errors.ts
  - packages/server/src/app.ts
  - packages/server/test/rate-limits.test.ts
  - apps/openboard/src/serve.ts
  - docs/decisions.md
conformance: []
modes: [local, hosted]
depends_on: [181, 184, 188, 196]
status: draft
claimed_by: null
issue: 360
---

## What the user does
As the operator of a shared instance, one organization writing in a loop is slowed with `rate_limited` and a `retry-after`, while other organizations and every reader keep their speed.

## Done when
- [ ] `bun test packages/server/test/rate-limits.test.ts` passes: 1,000 writes for one organization in the same instant pass, the next answers 429 `rate_limited` with `retry-after: 1` and writes nothing, another organization's write on the same instance passes, reads are never limited, and after the fake clock advances one second 200 more writes pass
- [ ] `bun run conformance` and `bun run bench --quick` report the same score and counters as before: the limit never bites the kit or the bench

## Out of scope
- The other limits of docs/auth.md "Rate limits": failed authentication (200), claims (201), refreshes (202), organization creation (203), invitations (204), sign-in attempts (205), open streams (206).
- Per-organization webhook delivery caps (M11, 324).

## Notes
- docs/auth.md "Rate limits" (writes per organization: 200/s, burst 1,000, per instance, so the sum across instances is about the configured rate times the instances), docs/codebase.md 4.4 step 4 and 4.5, D40. 429 `rate_limited` with `retry-after` (docs/protocol.md "Error envelope").
- Hot-path limits are token buckets per instance that hang off `createApp` (docs/codebase.md 5.6: no module-level state; time from `deps.now`), so a write pays no database round trip; limits that must hold across instances go to the database (201). docs/codebase.md 4.5 says the hosted implementation is "never an in-memory counter" while docs/auth.md and docs/architecture.md "SaaS seams" keep per-instance buckets for hot paths; this ticket follows the latter two and the PR says so.
- This ticket also lands what 200 to 206 key on, so they need not touch `pipeline.ts` or `app.ts` again: the limiter on the pipeline, the sign-in context and the handler context, and the client's IP. `app.fetch(request, { ip })` receives it from `apps/openboard/src/serve.ts` (Bun's `server.requestIP`); behind Railway's edge the client address comes from the forwarding header the edge sets. Check on staging which header Railway sets and that a client cannot forge it, and record the choice in docs/decisions.md.
- Depends on 184 (after 183) and 188, the last tickets before it to change `packages/server/src/app.ts`, `http/pipeline.ts` and `apps/openboard/src/serve.ts`, and on 196, whose handlers in `packages/server/src/operations/` the limits of 201 to 204 change next.
