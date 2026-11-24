---
id: 172
title: Answer 503 unavailable while the database is unreachable
milestone: M5-postgres-driver
package: driver-postgres
writes:
  - packages/driver-postgres/src/pool.ts
  - packages/driver-postgres/test/unavailable.test.ts
  - packages/driver-postgres/src/index.ts
  - packages/driver-postgres/package.json
  - packages/driver-postgres/tsconfig.json
  - bun.lock
conformance: []
modes: [hosted]
depends_on: [164]
status: done
claimed_by: claude-opus-t172
issue: 252
---

## What the user does
As an agent, when the board's database is down I get a fast, retryable `unavailable` answer instead of a request that hangs.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres/test/unavailable.test.ts` passes: a store on a URL nothing listens on rejects a read and a write with a `BoardError` of code `unavailable` (status 503) within the 3 s connect timeout
- [ ] in the same file, a write whose backend is terminated mid-transaction (`pg_terminate_backend`) rejects with `unavailable` and commits nothing, and the next read and write on the same store succeed without reopening it

## Out of scope
- `/readyz` turning 503 (M6, 184).
- Listeners re-subscribing and tails catching up by cursor (M6, 179); the full kill-the-database drill (M6, 180).
- Retrying a failed write server-side: never, unless the request carries an idempotency key (docs/architecture.md "Upgrade path to a failover database").

## Notes
- docs/architecture.md "Availability and failures" (database restart row) and docs/data-model.md "Postgres settings": connect timeout 3 s, `lock_timeout` 3 s (a board lock waited longer answers 503 `unavailable` too), `statement_timeout` 5 s, `idle_in_transaction_session_timeout` 10 s. Set them as connection startup parameters, not with session-level `SET`, so a reconnected connection keeps them (no session-pinned state, docs/architecture.md "Upgrade path").
- `unavailable` is already in the catalog (`packages/contract/src/errors.ts`, 503); the driver may throw `BoardError` (it imports `@openboard/contract`), and the pipeline already answers a thrown `BoardError` with its status. Map only connection-level failures and the three timeouts; a constraint violation stays a bug (500).
- Killing backends is SQL (`pg_terminate_backend`), so the helper lives in this driver's test, not in the server.
- Depends on 164 because both may change `packages/driver-postgres/src/pool.ts`.
