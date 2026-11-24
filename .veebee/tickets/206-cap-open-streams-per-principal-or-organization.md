---
id: 206
title: Cap open streams per principal or organization
milestone: M7-hosted-deploy
package: server
writes:
  - packages/ports/src/seams.ts
  - packages/server/src/http/limits.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/operations/events.ts
  - packages/server/src/live/sse.ts
  - packages/contract/src/operations/events.ts
  - packages/server/openapi.json
  - skills/openboard/references/commands.md
  - docs/protocol.md
  - tools/bench/src/workloads/sse.ts
  - packages/server/test/stream-caps.test.ts
  - packages/server/test/ha/drill.test.ts
conformance: []
modes: [local, hosted]
depends_on: [102, 183, 199]
status: done
claimed_by: codex
issue: 367
---

## What the user does
As the operator of a shared instance, a principal opening streams in a loop is refused past 20 open streams, and an organization past 500, while closing one lets the next in.

## Done when
- [x] `bun test packages/server/test/stream-caps.test.ts` passes: one principal's 21st open SSE stream on an instance answers 429 `rate_limited` with a `retry-after` before any frame, closing one of its streams admits the next, another principal of the same organization still streams, and an organization's 501st stream across its principals is refused the same way
- [x] `bun run bench --quick` still opens its 50 SSE tails within budget (108)

## Out of scope
- Long-polls: held at most 120 s and not capped here.
- A cap across instances: per instance, as docs/auth.md "Rate limits" lists it.

## Notes
- docs/auth.md "Rate limits" (SSE streams per principal / per organization: 20 / 500, per instance). Count open streams on the instance's limiter from 199, released when a stream ends for any reason (client gone, 280 s end of 102, drain of 183), so a crashed client cannot hold a slot.
- Depends on 102 and 183, the last tickets to change `packages/server/src/live/sse.ts` before this one.
