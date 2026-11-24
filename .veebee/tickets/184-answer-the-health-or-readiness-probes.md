---
id: 184
title: Answer the health or readiness probes
milestone: M6-high-availability
package: server
writes:
  - packages/server/src/http/health.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/app.ts
  - packages/ports/src/store.ts
  - packages/driver-postgres/src/pool.ts
  - packages/driver-sqlite/src/open.ts
  - packages/server/test/health.test.ts
  - packages/server/test/ha/readiness.test.ts
  - docs/protocol.md
  - packages/driver-postgres/src/database.ts
  - packages/driver-postgres/src/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/readiness.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/test/support/drivers.ts
conformance: []
modes: [local, hosted]
depends_on: [177, 183]
status: done
claimed_by: Codex (/root)
issue: 264
---

## What the user does
As an operator or a load balancer, I ask an instance whether it is alive and whether it should get traffic.

## Done when
- [ ] `curl -s http://127.0.0.1:8787/healthz` on `openboard serve` answers 200 with the running version and no database call, and `curl -s http://127.0.0.1:8787/readyz` answers 200, both without a credential, in local and in hosted mode
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/readiness.test.ts` passes: `/readyz` answers 503 while the instance drains, while the database does not answer within 1 s, and while the database's schema is older than the instance needs; `/healthz` stays 200 in all three

## Out of scope
- Prometheus metrics at `/api/x/metrics` (M15).
- Railway's healthcheck settings (189).

## Notes
- docs/architecture.md "Health, readiness, shutdown": `/healthz` alive, no database call; `/readyz` database answers within 1 s, schema compatible, listener connected (or polling: 178), not draining (183). docs/codebase.md 2.2: `/healthz` and `/readyz` are unauthenticated and outside `/api`, so they never collide with D8.
- The store reports what readiness needs (a ping, the applied schema level against the newest migration the instance knows) through a method on the `Store` port (`packages/ports/src/store.ts`, an append point), implemented in each driver.
- `/healthz` names the version so `scripts/release/railway-deploy.ts` (189) can wait until every replica runs the new one.
