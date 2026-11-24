---
id: 394
title: Serve operator metrics at /api/x/metrics
milestone: M15-operations
package: server
writes:
  - packages/contract/src/operations/metrics.ts
  - packages/contract/src/operations/index.ts
  - packages/server/src/operations/metrics.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/metrics.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/deps.ts
  - packages/server/test/metrics.test.ts
  - apps/openboard/src/config.ts
  - apps/openboard/test/config.test.ts
  - docs/codebase.md
  - docs/decisions.md
conformance: []
modes: [local, hosted]
depends_on: [215, 341, 393]
status: draft
claimed_by: null
issue: 589
---

## What the user does
As the operator, I scrape each instance's `/api/x/metrics` with an operator token and see its memory, latency per operation, board-lock waits, open streams, job queues, webhook outcomes and auth failures, without any tenant being able to read them.

## Done when
- [ ] with `OPENBOARD_METRICS_TOKEN_FILE` set, `curl -s http://127.0.0.1:8787/api/x/metrics -H @metrics.header` (a file holding `authorization: Bearer <token>`, so the token stays off argv) answers 200 `text/plain; version=0.0.4` in the Prometheus text format, with at least `openboard_process_resident_bytes`, `openboard_request_duration_seconds` (histogram by route template and status), `openboard_board_lock_wait_seconds`, `openboard_open_streams`, `openboard_jobs_due` and `openboard_jobs_oldest_due_seconds` per kind, `openboard_webhook_deliveries_total` by outcome and `openboard_auth_failures_total`, each labelled with the instance ID
- [ ] `bun test packages/server/test/metrics.test.ts` passes on SQLite and Postgres: without the variable the route answers 404 `not_found`; with it, no credential, an owner token, a session or a connection secret answers 401 `unauthorized`; no label holds an organization slug, a channel, a principal or message text (organization IDs only, in the top-talkers series); a scrape adds no statement to any other request (`bun run bench --quick` counters unchanged)

## Out of scope
- Scraping, dashboards and alerts: the owner's monitoring (none is chosen; Railway has no Prometheus scraper of its own).
- Per-tenant usage numbers (396).

## Notes
- docs/architecture.md "Observability" (Prometheus metrics at `/api/x/metrics` for operators, not tenants, and the list of series). No doc says how an operator authenticates: **proposed** `OPENBOARD_METRICS_TOKEN` (or `_FILE`), compared in constant time; unset, the route does not exist. Record it in docs/decisions.md and docs/codebase.md 5.5.
- Counters and histograms live in a registry created per app from `deps` (`packages/server/src/metrics.ts`), never at module level (AGENTS.md non-negotiable 8); each instance reports its own, labelled with `OPENBOARD_INSTANCE_ID`. Values that belong to the database (jobs due, their age) are read at scrape time with indexed queries.
- The pipeline (`packages/server/src/http/pipeline.ts`) records each request's route template, status and duration where it already writes its log line (docs/codebase.md 5.4).
- The route is a contract operation like every other (`cli: false`, `mcp: false`, with the reason that it is for operators), answering text instead of JSON.
- Depends on 393 and 341, the last tickets before it to change docs/codebase.md and `packages/server/src/http/pipeline.ts`.
