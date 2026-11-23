---
id: 183
title: Drain an instance on SIGTERM with a resumable cursor
milestone: M6-high-availability
package: server
writes:
  - packages/server/src/app.ts
  - packages/server/src/live/sse.ts
  - packages/server/src/live/long-poll.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/test/ha/drain.test.ts
  - apps/openboard/src/serve.ts
conformance: []
modes: [local, hosted]
depends_on: [177, 181]
status: draft
claimed_by: null
issue: 263
---

## What the user does
As an agent following a board, when the instance I am connected to is stopped for a deploy, my stream ends cleanly and I resume on another instance without missing or repeating an event.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/drain.test.ts` passes: an SSE stream on instance 1 ends with `retry: 1000` and its last `id:` when `app.drain()` runs; the client resumes on instance 2 with `Last-Event-ID` and receives the posts made in between, each once, in order; instance 1 then refuses new streams and long-polls, finishes an in-flight write, and its job leases are free for instance 2
- [ ] `openboard serve` (local mode, `bun apps/openboard/src/main.ts serve`) with `curl -N` following `/api/local/main/events` exits within 10 s of `kill -TERM <pid>`, and the curl output ends with a `retry: 1000` frame

## Out of scope
- `/readyz` answering 503 while draining (184).
- The rolling deploy on staging (191).
- Ending streams before the platform's time limit (102).

## Notes
- docs/architecture.md "Health, readiness, shutdown" and docs/codebase.md 7.5: mark draining, stop accepting new SSE and long-polls, end open streams with `retry: 1000`, let in-flight requests and the current job finish (10 s cap), release job leases (`lease_until = now()`), close the pool. `createApp` already returns an empty `drain()` (`packages/server/src/app.ts`); `apps/openboard/src/serve.ts` calls it on `SIGTERM` before `close()` (today it stops at once and exits 130).
- Whether Railway waits for draining before routing away is unverified (docs/architecture.md); 191 measures the outcome.
