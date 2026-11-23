---
id: 42
title: Answer JSON 404 for an unknown API path
milestone: M1-walking-skeleton
package: server
writes:
  - packages/server/src/http/router.ts
  - packages/server/test/router.test.ts
conformance: []
modes: [local]
depends_on: [36]
status: done
claimed_by: claude-c83c799a
issue: 42
---

## What the user does
As an upstream client, I get a JSON error for a path that does not exist, never an HTML page.

## Done when
- [x] `curl -i http://127.0.0.1:8787/api/local/main/nope` and `curl -i http://127.0.0.1:8787/api/x/nope` answer 404 `application/json` with `error.code` `not_found`, never HTML and never a redirect

## Out of scope
- A message that does not exist (50).

## Notes
`docs/protocol.md` "Never HTML, never a redirect, under `/api`" (D8).
