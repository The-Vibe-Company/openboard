---
id: 58
title: Print one JSON log line per request
milestone: M1-walking-skeleton
package: server
writes:
  - packages/server/src/log.ts
  - packages/server/src/deps.ts
  - packages/server/test/log.test.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/index.ts
  - packages/server/test/support/app.ts
  - packages/server/test/auth/local-owner.test.ts
  - apps/openboard/src/compose.ts
  - tools/bench/src/drivers.ts
  - tools/conformance/src/drivers.ts
conformance: []
modes: [local]
depends_on: [36]
status: done
claimed_by: claude-opus-5-5
issue: 58
---

## What the user does
As an operator, I read one structured line per request in the server output.

## Done when
- [x] each request to `ob serve` prints one JSON line with `req`, `op`, `org`, `actor`, `ms` and the status

## Out of scope
- Redaction (59).
- Request IDs (60).

## Notes
`docs/codebase.md` 5.4.
