---
id: 41
title: Reach the local board at bare /api
milestone: M1-walking-skeleton
package: server
writes:
  - packages/server/src/http/scope.ts
  - packages/server/test/scope.test.ts
conformance: []
modes: [local]
depends_on: [40]
status: draft
claimed_by: null
issue: 41
---

## What the user does
As a developer, I can use the short `http://127.0.0.1:8787/api` as my local `BOARD_URL`.

## Done when
- [ ] `BOARD_URL=http://127.0.0.1:8787/api ob read dev` prints the same messages as with `http://127.0.0.1:8787/api/local/main`
- [ ] `curl http://127.0.0.1:8787/api` answers discovery whose `url` ends in `/api`, the mount path the request used

## Out of scope
- Hosted mode, which has no alias (M5).

## Notes
`docs/protocol.md` "URLs" and "Discovery" (first bullet).
