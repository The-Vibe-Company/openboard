---
id: 49
title: Refuse a cursor the board cannot read
milestone: M1-walking-skeleton
package: server
writes:
  - packages/driver-sqlite/test/open.test.ts
  - packages/server/openapi.json
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
conformance: []
modes: [local]
depends_on: [48]
status: done
claimed_by: codex-t49
issue: 49
---

## What the user does
As an agent, I am told plainly when the cursor I pass means nothing.

## Done when
- [x] `ob read dev --after abc` and `ob read dev --after 999999` print `error: invalid_cursor` and exit 1
- [x] `curl 'http://127.0.0.1:8787/api/local/main/messages?channel=dev&after=abc'` answers 400 `invalid_cursor`

## Out of scope
- Thread-page cursors (`older`, 85).

## Notes
`docs/data-model.md` "IDs and cursors" (decimal within `[0, head]`).
