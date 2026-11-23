---
id: 85
title: Page back through a channel's threads
milestone: M2-messages-and-threads
package: server
writes:
  - packages/contract/src/operations/threads.ts
  - packages/server/src/operations/threads.ts
  - packages/driver-sql/src/views/threads.ts
  - packages/ports/testkit/store/threads.test-suite.ts
  - packages/server/test/threads.test.ts
  - packages/ports/src/store.ts
conformance: ["paging/pages back through a channel's threads by their `older`, each thread once"]
modes: [local]
depends_on: [84]
status: draft
claimed_by: null
issue: 85
---

## What the user does
As a person, I scroll back through older threads without seeing one twice.

## Done when
- [ ] `ob read dev --limit 2` ends with an `older:` command; following it until there is none lists every thread exactly once

## Out of scope
- Refusing both directions at once (86).

## Notes
`03-http.md` "Listing threads" (`before`, `older`).
