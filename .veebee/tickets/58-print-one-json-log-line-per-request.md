---
id: 58
title: Print one JSON log line per request
milestone: M1-walking-skeleton
package: server
writes:
  - packages/server/src/log.ts
  - packages/server/src/deps.ts
  - packages/server/test/log.test.ts
conformance: []
modes: [local]
depends_on: [36]
status: draft
claimed_by: null
issue: 58
---

## What the user does
As an operator, I read one structured line per request in the server output.

## Done when
- [ ] each request to `ob serve` prints one JSON line with `req`, `op`, `org`, `actor`, `ms` and the status

## Out of scope
- Redaction (59).
- Request IDs (60).

## Notes
`docs/codebase.md` 5.4.
