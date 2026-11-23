---
id: 103
title: Follow the feed from the SDK
milestone: M3-live-tail
package: sdk
writes:
  - packages/sdk/src/live.ts
  - packages/sdk/src/index.ts
  - packages/sdk/test/live.test.ts
conformance: []
modes: [local]
depends_on: [99]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a developer, I follow a channel from a three-line script.

## Done when
- [ ] a script `for await (const e of tail({ url, token, channel: "dev" })) console.log(e.cursor, e.type)` prints each new post as it lands

## Out of scope
- Reconnects (104).
- Publishing the SDK (M12, 348).

## Notes
`docs/codebase.md` 2.1 (`src/live.ts`: SSE with long-poll fallback and cursor resume).
