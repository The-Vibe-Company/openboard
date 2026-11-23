---
id: 60
title: Echo a request ID on every answer
milestone: M1-walking-skeleton
package: server
writes:
  - packages/server/src/http/pipeline.ts
  - packages/server/src/log.ts
  - packages/server/test/request-id.test.ts
conformance: []
modes: [local]
depends_on: [38, 59]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an operator, I follow one request from the client's error to the server's log line.

## Done when
- [ ] `curl -i http://127.0.0.1:8787/api/local/main` shows an `x-request-id`; sending `x-request-id: abc` gets `abc` back, and the log line carries it

## Out of scope
- Tracing across instances (M6).

## Notes
`docs/protocol.md` "Request headers".
